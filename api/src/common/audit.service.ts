import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RealtimeGateway } from "./realtime.gateway";
import { AuditAction, PlanState } from "@plot/db";

// A compensating-action descriptor. Each `type` has a corresponding handler in `undo()`.
// This is what makes every autonomous action reversible (PRD §13).
export type UndoDescriptor =
  | { type: "DELETE_MESSAGE"; messageId: string }
  | { type: "DELETE_PLAN"; planId: string }
  | { type: "UNLOCK_PLAN"; planId: string; prevState: PlanState }
  | { type: "REVOKE_NONUSER_TOKEN"; tokenId: string }
  | { type: "REFUND_SPEND"; planId: string; amountCents: number }
  | { type: "CANCEL_BOOKING"; planId: string; prevState: PlanState; amountCents: number }
  | { type: "REFUND_SPLIT"; splitId: string; planId: string; amountCents: number }
  | { type: "CLEAR_CONTINGENCIES"; planId: string }
  | { type: "RESTORE_LOCKED"; planId: string; optionId: string | null; time: string | null; place: string | null }
  | { type: "NONE" };

@Injectable()
export class AuditService {
  private readonly log = new Logger("Audit");
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Write one immutable audit row. Returns the row. Broadcasts audit.created to the thread.
  async record(opts: {
    planId?: string;
    actor?: string;
    action: AuditAction;
    summary: string;
    payload: Record<string, unknown>;
    undo?: UndoDescriptor;
    amountCents?: number;
    threadId?: string;
  }) {
    const row = await this.prisma.auditLog.create({
      data: {
        planId: opts.planId,
        actor: opts.actor ?? "plot",
        action: opts.action,
        summary: opts.summary,
        payload: opts.payload as object,
        undo: (opts.undo ?? { type: "NONE" }) as object,
        amountCents: opts.amountCents ?? 0,
      },
    });
    const threadId =
      opts.threadId ??
      (opts.planId
        ? (await this.prisma.plan.findUnique({ where: { id: opts.planId } }))?.threadId
        : undefined);
    if (threadId) {
      this.realtime.emitToThread(threadId, "audit.created", this.toDto(row));
    }
    this.log.log(`audit ${row.action} — ${row.summary}`);
    return row;
  }

  toDto(row: {
    id: string;
    actor: string;
    action: AuditAction;
    summary: string;
    amountCents: number;
    undo: unknown;
    undoneAt: Date | null;
    createdAt: Date;
  }) {
    const undo = row.undo as UndoDescriptor | null;
    return {
      id: row.id,
      actor: row.actor,
      action: row.action,
      summary: row.summary,
      amountCents: row.amountCents,
      undoable: !!undo && undo.type !== "NONE" && !row.undoneAt,
      undoneAt: row.undoneAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  // Apply the compensating action recorded on a row. Idempotent: marks undoneAt.
  async undo(auditId: string): Promise<{ ok: boolean; action: string; detail: string }> {
    const row = await this.prisma.auditLog.findUnique({ where: { id: auditId } });
    if (!row) throw new BadRequestException("audit row not found");
    if (row.undoneAt) return { ok: true, action: "noop", detail: "already undone" };
    const undo = (row.undo ?? { type: "NONE" }) as UndoDescriptor;

    let detail = "";
    switch (undo.type) {
      case "DELETE_MESSAGE":
        await this.prisma.message.deleteMany({ where: { id: undo.messageId } });
        detail = `removed message ${undo.messageId}`;
        break;
      case "DELETE_PLAN":
        // remove dependent rows then the plan
        await this.prisma.vote.deleteMany({ where: { planId: undo.planId } });
        await this.prisma.planOption.deleteMany({ where: { planId: undo.planId } });
        await this.prisma.bringItem.deleteMany({ where: { planId: undo.planId } });
        await this.prisma.rsvp.deleteMany({ where: { planId: undo.planId } });
        await this.prisma.message.updateMany({
          where: { planId: undo.planId },
          data: { planId: null },
        });
        await this.prisma.plan.update({
          where: { id: undo.planId },
          data: { state: PlanState.CANCELLED },
        });
        detail = `cancelled plan ${undo.planId}`;
        break;
      case "UNLOCK_PLAN": {
        const plan = await this.prisma.plan.update({
          where: { id: undo.planId },
          data: {
            state: undo.prevState,
            lockedOptionId: null,
            lockedTime: null,
            lockedPlace: null,
          },
        });
        detail = `unlocked plan ${undo.planId} → ${undo.prevState}`;
        this.realtime.emitToThread(plan.threadId, "plan.updated", { id: plan.id });
        break;
      }
      case "REVOKE_NONUSER_TOKEN":
        await this.prisma.nonUserToken.updateMany({
          where: { id: undo.tokenId },
          data: { usedAt: new Date(0) }, // sentinel: revoked
        });
        detail = `revoked non-user token ${undo.tokenId}`;
        break;
      case "REFUND_SPEND":
        await this.prisma.plan.update({
          where: { id: undo.planId },
          data: { spentCents: { decrement: undo.amountCents } },
        });
        detail = `refunded ${undo.amountCents}c on plan ${undo.planId}`;
        break;
      case "CANCEL_BOOKING": {
        const plan = await this.prisma.plan.update({
          where: { id: undo.planId },
          data: {
            state: undo.prevState,
            bookingRef: null,
            spentCents: { decrement: undo.amountCents },
          },
        });
        detail = `cancelled booking on plan ${undo.planId} → ${undo.prevState}`;
        this.realtime.emitToThread(plan.threadId, "plan.updated", { id: plan.id });
        break;
      }
      case "REFUND_SPLIT":
        await this.prisma.split.updateMany({ where: { id: undo.splitId }, data: { state: "REFUNDED" } });
        await this.prisma.plan.update({
          where: { id: undo.planId },
          data: { spentCents: { decrement: undo.amountCents } },
        });
        detail = `refunded split ${undo.splitId}`;
        break;
      case "CLEAR_CONTINGENCIES":
        await this.prisma.plan.update({ where: { id: undo.planId }, data: { contingencies: [] } });
        detail = `cleared contingencies on plan ${undo.planId}`;
        break;
      case "RESTORE_LOCKED": {
        const plan = await this.prisma.plan.update({
          where: { id: undo.planId },
          data: {
            lockedOptionId: undo.optionId,
            lockedTime: undo.time ? new Date(undo.time) : null,
            lockedPlace: undo.place,
          },
        });
        detail = `restored the prior locked option on plan ${undo.planId}`;
        this.realtime.emitToThread(plan.threadId, "plan.updated", { id: plan.id });
        break;
      }
      default:
        return { ok: false, action: "none", detail: "nothing to undo" };
    }

    await this.prisma.auditLog.update({
      where: { id: auditId },
      data: { undoneAt: new Date() },
    });
    // record the compensating action itself as a new immutable row
    await this.record({
      planId: row.planId ?? undefined,
      actor: "operator",
      action: AuditAction.PLAN_UNLOCKED,
      summary: `Undo of "${row.summary}": ${detail}`,
      payload: { undoneAudit: auditId },
      undo: { type: "NONE" },
    });
    return { ok: true, action: undo.type, detail };
  }
}
