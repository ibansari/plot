import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { MoneyService } from "./money.service";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../common/audit.service";
import { AuthGuard, AuthedRequest } from "../common/auth.guard";
import { AuditAction, PermissionScope } from "@plot/db";

// Internal endpoint the agent's settle-up node calls to auto-split a locked plan (PRD §B1).
// Money is least-authority (§13): collecting a split needs the group's SPEND_MONEY grant. Without
// it we DON'T move money — we tell the agent it needs permission so it can ask in-thread.
@UseGuards(AuthGuard)
@Controller("internal")
export class MoneyController {
  constructor(
    private readonly money: MoneyService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Default-deny group permission check (mirrors IntegrationsService.hasPermission).
  private async groupHasScope(groupId: string, scope: PermissionScope) {
    const grant = await this.prisma.permission.findFirst({
      where: { scope, granted: true, groupId },
    });
    return !!grant;
  }

  @Post("plans/:id/split")
  async split(
    @Param("id") planId: string,
    @Body() b: { totalCents?: number; perHeadCents?: number; memo?: string },
  ) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    if (!(await this.groupHasScope(plan.groupId, PermissionScope.SPEND_MONEY))) {
      // not granted → no money moves; the agent turns this into an in-thread permission ask.
      return { created: false, needsPermission: true, scope: PermissionScope.SPEND_MONEY };
    }

    const members = await this.prisma.groupMember.count({ where: { groupId: plan.groupId } });
    const n = Math.max(members, 1);
    const total = b.totalCents ?? (b.perHeadCents ?? 0) * n;
    const memo = b.memo ?? `Split for "${plan.title}"`;
    const split = await this.money.createEvenSplit(planId, total, memo);
    const perHead = split.shares[0]?.amountCents ?? Math.floor(total / n);

    await this.audit.record({
      planId,
      action: AuditAction.AGENT_CREATED_SPLIT,
      summary: `Set up an even split — ${perHead}c each across ${n} (${memo})`,
      payload: { splitId: split.id, totalCents: total, perHeadCents: perHead, members: n },
      // reversible: refunding the escrow hold rolls the whole collection back
      undo: { type: "REFUND_SPLIT", splitId: split.id, planId, amountCents: 0 },
      threadId: plan.threadId,
    });

    return {
      created: true,
      split: { id: split.id, totalCents: total, perHeadCents: perHead, state: split.state, members: n },
    };
  }
}

// Public money surface for app users: see the split + pay your own share (Money sheet).
@UseGuards(AuthGuard)
@Controller()
export class MoneyPublicController {
  constructor(private readonly money: MoneyService) {}

  @Get("plans/:id/split")
  getSplit(@Param("id") planId: string) {
    return this.money.getSplit(planId);
  }

  @Post("splits/:id/pay")
  pay(@Param("id") splitId: string, @Req() req: AuthedRequest) {
    return this.money.payShare({ splitId, userId: req.userId! });
  }
}
