import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../common/audit.service";
import { RealtimeGateway } from "../common/realtime.gateway";
import { InngestService } from "../inngest/inngest.service";
import { config } from "../common/config";
import {
  AuditAction,
  MessageKind,
  OptionKind,
  PermissionScope,
  PlanState,
  RsvpStatus,
  VoteValue,
} from "@plot/db";
import { nextState, PlanEvent } from "./plan.statemachine";
import { BOOKING_PROVIDER, BookingProvider } from "./booking/booking.provider";

export interface ProposeOptionInput {
  kind: OptionKind;
  label: string;
  startsAt?: string;
  endsAt?: string;
  place?: string;
  priceTier?: number;
  phone?: string; // for graceful booking degradation (tap-to-call)
  url?: string;
  why?: string; // "why it fits this group" rationale (§A2), referencing a known constraint
  fitFlags?: string[]; // poor-fit reasons (over budget, dietary, disliked) shown on the card
}

export interface Contingency {
  ifText: string;
  thenText: string;
  type: string; // "switch_backup" | "rebalance" | "hold"
  backupOptionId?: string;
}

@Injectable()
export class PlanService {
  private readonly log = new Logger("Plan");
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly inngest: InngestService,
    @Inject(BOOKING_PROVIDER) private readonly booking: BookingProvider,
  ) {}

  // ── transition helper: load, validate, persist new state ──
  private async transition(planId: string, event: PlanEvent) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const to = nextState(plan.state, event); // throws IllegalTransitionError if not allowed
    return this.prisma.plan.update({ where: { id: planId }, data: { state: to } });
  }

  // ── the agent's propose-decision node lands here: build the plan + decision card + open voting ──
  async proposeDecision(input: {
    threadId: string;
    groupId: string;
    title: string;
    options: ProposeOptionInput[];
    organizerId?: string;
    spendCapCents?: number;
    surpriseMode?: boolean;
    method?: string; // decision method Plot chose (§A3): "boost_veto" | "ranked"
    summary?: string; // Plot's natural-language card body surfacing its fit reasoning (§A2)
  }) {
    if (input.options.length < 2) throw new BadRequestException("need at least 2 options to vote on");

    const softDeadline = new Date(Date.now() + config.softDeadlineSeconds * 1000);
    const plan = await this.prisma.plan.create({
      data: {
        groupId: input.groupId,
        threadId: input.threadId,
        title: input.title,
        organizerId: input.organizerId,
        spendCapCents: input.spendCapCents ?? config.defaultSpendCapCents,
        surpriseMode: input.surpriseMode ?? false,
        softDeadline,
        options: {
          create: input.options.map((o) => ({
            kind: o.kind,
            label: o.label,
            startsAt: o.startsAt ? new Date(o.startsAt) : null,
            endsAt: o.endsAt ? new Date(o.endsAt) : null,
            place: o.place,
            priceTier: o.priceTier,
            metadata:
              o.phone || o.url || o.why || o.fitFlags
                ? { phone: o.phone, url: o.url, why: o.why, fitFlags: o.fitFlags }
                : undefined,
          })),
        },
      },
      include: { options: true },
    });

    // DRAFT → PROPOSED → VOTING
    await this.transition(plan.id, "propose");
    await this.transition(plan.id, "openVoting");

    // self-enforcing contingencies (shown on Plot's Desk; the second-place option is the backup)
    await this.setContingencies(plan.id, this.defaultContingencies(plan.options), { silent: true });

    // post the decision card into the thread
    const card = await this.prisma.message.create({
      data: {
        threadId: input.threadId,
        kind: MessageKind.DECISION_CARD,
        body: input.summary ?? `✦ Plot proposed a plan: ${input.title}`,
        planId: plan.id,
        metadata: {
          kind: "decision_card",
          planId: plan.id,
          softDeadline: softDeadline.toISOString(),
          method: input.method ?? "boost_veto",
        },
      },
    });
    this.realtime.emitToThread(input.threadId, "message.created", await this.messageDto(card.id));

    await this.audit.record({
      planId: plan.id,
      action: AuditAction.AGENT_PROPOSED_PLAN,
      summary: `Proposed "${input.title}" with ${input.options.length} options`,
      payload: { options: input.options.map((o) => o.label) },
      undo: { type: "DELETE_PLAN", planId: plan.id },
      threadId: input.threadId,
    });
    await this.audit.record({
      planId: plan.id,
      action: AuditAction.AGENT_OPENED_VOTING,
      summary: `Opened voting; soft deadline in ${config.softDeadlineSeconds}s`,
      payload: { softDeadline: softDeadline.toISOString() },
      undo: { type: "NONE" },
      threadId: input.threadId,
    });

    // hand the timer to the durable workflow (Inngest owns time; it will call the agent back)
    await this.inngest.send("plot/voting.opened", {
      planId: plan.id,
      threadId: input.threadId,
      softDeadlineIso: softDeadline.toISOString(),
    });

    await this.broadcastPlan(plan.id);
    return this.getPlan(plan.id);
  }

  // ── voting ──
  async castVote(
    planId: string,
    voter: { userId?: string; contactId?: string; viaToken?: string },
    optionId: string,
    value: VoteValue = VoteValue.UP,
  ) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    if (plan.state !== PlanState.VOTING) throw new BadRequestException("voting is not open");

    // upsert by (option, voter) — one vote per option per voter; switching value updates it
    const where = voter.userId
      ? { optionId_userId: { optionId, userId: voter.userId } }
      : { optionId_contactId: { optionId, contactId: voter.contactId! } };
    await this.prisma.vote.upsert({
      where: where as never,
      update: { value, viaToken: voter.viaToken },
      create: { planId, optionId, value, userId: voter.userId, contactId: voter.contactId, viaToken: voter.viaToken },
    });
    await this.broadcastPlan(planId);
    return this.getPlan(planId);
  }

  async setRsvp(planId: string, who: { userId?: string; contactId?: string }, status: RsvpStatus) {
    const where = who.userId
      ? { planId_userId: { planId, userId: who.userId } }
      : { planId_contactId: { planId, contactId: who.contactId! } };
    await this.prisma.rsvp.upsert({
      where: where as never,
      update: { status },
      create: { planId, status, userId: who.userId, contactId: who.contactId },
    });
    await this.broadcastPlan(planId);
    return this.getPlan(planId);
  }

  // ── spend-cap gate (§13 #4). Returns {allowed} or {needsApproval}. ──
  async checkSpend(planId: string, amountCents: number): Promise<{ allowed: boolean; remaining: number }> {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const remaining = plan.spendCapCents - plan.spentCents;
    return { allowed: amountCents <= remaining, remaining };
  }

  // ── lock (the act node / auto-lock). NO booking required; resolution = time+place+RSVP. ──
  async lock(planId: string, opts: { actor?: string; reason?: string } = {}) {
    const plan = await this.prisma.plan.findUniqueOrThrow({
      where: { id: planId },
      include: { options: { include: { votes: true } } },
    });
    if (plan.state !== PlanState.VOTING) throw new BadRequestException(`cannot lock from ${plan.state}`);

    const leader = this.pickLeader(plan.options);
    if (!leader) throw new BadRequestException("no options to lock");

    await this.transition(planId, "lock");
    const locked = await this.prisma.plan.update({
      where: { id: planId },
      data: {
        lockedOptionId: leader.id,
        lockedTime: leader.startsAt ?? plan.softDeadline,
        lockedPlace: leader.place ?? leader.label,
      },
    });

    // auto-generate the bring-list (every lock produces one)
    const bring = this.bringListFor(leader.label, leader.place);
    await this.prisma.bringItem.createMany({
      data: bring.map((label) => ({ planId, label, generated: true })),
    });

    // post lock confirmation
    const msg = await this.prisma.message.create({
      data: {
        threadId: plan.threadId,
        kind: MessageKind.AGENT,
        body: `✦ Locked: ${leader.label}${leader.place ? ` @ ${leader.place}` : ""}. RSVPs frozen; bring-list posted.`,
        planId,
      },
    });
    this.realtime.emitToThread(plan.threadId, "message.created", await this.messageDto(msg.id));

    await this.audit.record({
      planId,
      actor: opts.actor ?? "plot",
      action: AuditAction.AGENT_LOCKED_PLAN,
      summary: `Locked leader "${leader.label}" (${opts.reason ?? "soft-deadline"})`,
      payload: { leaderOptionId: leader.id, place: leader.place, time: locked.lockedTime?.toISOString() },
      // the compensating action: roll back to VOTING
      undo: { type: "UNLOCK_PLAN", planId, prevState: PlanState.VOTING },
      threadId: plan.threadId,
    });
    await this.audit.record({
      planId,
      action: AuditAction.AGENT_GENERATED_BRINGLIST,
      summary: `Generated bring-list (${bring.length} items)`,
      payload: { items: bring },
      undo: { type: "NONE" },
      threadId: plan.threadId,
    });

    await this.broadcastPlan(planId);
    return this.getPlan(planId);
  }

  // ── booking: additive enrichment on a LOCKED plan. Books when possible, else degrades to
  // tap-to-call/deep-link. Agent-initiated booking is gated by BOOK_VENUE + the spend cap (§13);
  // an organizer's explicit tap is an authorized human action. Reversible (CANCEL_BOOKING undo). ──
  async book(planId: string, opts: { actor?: string } = {}) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    if (plan.state !== PlanState.LOCKED) throw new BadRequestException("can only book a LOCKED plan");

    const option = plan.lockedOptionId
      ? await this.prisma.planOption.findUnique({ where: { id: plan.lockedOptionId } })
      : null;
    const meta = (option?.metadata as { phone?: string; url?: string } | null) ?? null;
    const partySize = await this.prisma.groupMember.count({ where: { groupId: plan.groupId } });
    const estCents = (option?.priceTier ?? 1) * 2000 * Math.max(partySize, 1);
    const byPlot = (opts.actor ?? "plot") === "plot";

    if (byPlot) {
      const granted = await this.prisma.permission.findFirst({
        where: { groupId: plan.groupId, scope: PermissionScope.BOOK_VENUE, granted: true },
      });
      if (!granted) return { booked: false, needsPermission: true, scope: PermissionScope.BOOK_VENUE, planId };
      if (plan.spentCents + estCents > plan.spendCapCents) {
        return { booked: false, needsApproval: true, amountCents: estCents, planId };
      }
    }

    const attempt = await this.booking.book({
      place: plan.lockedPlace ?? "",
      time: plan.lockedTime?.toISOString() ?? "",
      partySize: Math.max(partySize, 1),
      phone: meta?.phone,
      url: meta?.url,
    });

    if (attempt.booked) {
      await this.transition(planId, "book");
      await this.prisma.plan.update({
        where: { id: planId },
        data: { bookingRef: attempt.confirmation, bookingFallback: undefined, spentCents: { increment: estCents } },
      });
      const msg = await this.prisma.message.create({
        data: {
          threadId: plan.threadId,
          kind: MessageKind.AGENT,
          body: `✦ Booked ${partySize}× — ${plan.lockedPlace}. Confirmation ${attempt.confirmation}. Added to everyone's calendar.`,
          planId,
        },
      });
      this.realtime.emitToThread(plan.threadId, "message.created", await this.messageDto(msg.id));
      await this.audit.record({
        planId,
        actor: opts.actor ?? "plot",
        action: AuditAction.AGENT_BOOKED,
        summary: `Booked "${plan.lockedPlace}" (${attempt.confirmation}) · $${Math.round(estCents / 100)}`,
        payload: { confirmation: attempt.confirmation, place: plan.lockedPlace, amountCents: estCents },
        amountCents: estCents,
        undo: { type: "CANCEL_BOOKING", planId, prevState: PlanState.LOCKED, amountCents: estCents },
        threadId: plan.threadId,
      });
    } else {
      // graceful degradation: record the tap-to-call / deep-link fallback on the plan
      await this.prisma.plan.update({
        where: { id: planId },
        data: { bookingFallback: attempt.fallback as unknown as object },
      });
      await this.audit.record({
        planId,
        actor: opts.actor ?? "plot",
        action: AuditAction.AGENT_BOOKED,
        summary: `No integration for ${plan.lockedPlace} — left a ${attempt.fallback?.kind ?? "link"} fallback`,
        payload: { fallback: attempt.fallback },
        undo: { type: "NONE" },
        threadId: plan.threadId,
      });
    }
    await this.broadcastPlan(planId);
    return { ...attempt, planId };
  }

  // ── contingencies: self-enforcing "if X then Y" rules shown on Plot's Desk (§8 H). ──
  // The backup is the second option, so a fallen-through leader always has somewhere to go.
  defaultContingencies(
    options: { id: string; label: string; place: string | null; startsAt: Date | null }[],
  ): Contingency[] {
    const out: Contingency[] = [];
    const backup = options[1];
    if (backup) {
      out.push({
        ifText: "the top pick falls through (fully booked / cancelled)",
        thenText: `switch to "${backup.label}"`,
        type: "switch_backup",
        backupOptionId: backup.id,
      });
    }
    // an outdoor option benefits from a weather fallback
    const hasOutdoor = options.some((o) =>
      /rooftop|patio|park|outdoor|picnic|hike|garden/i.test(`${o.label} ${o.place ?? ""}`),
    );
    if (hasOutdoor) {
      out.push({
        ifText: "the forecast turns (rain / cold)",
        thenText: "ping the group to move somewhere indoors",
        type: "hold",
      });
    }
    out.push({
      ifText: "two or more people are running >15 min late",
      thenText: "push the start by 30 min and tell everyone",
      type: "rebalance",
    });
    return out;
  }

  // Persist contingencies on the plan + write a reversible audit row (CLEAR_CONTINGENCIES undo).
  // `silent` skips re-broadcasting when called inline during propose (the plan broadcast follows).
  async setContingencies(planId: string, contingencies: Contingency[], opts: { silent?: boolean } = {}) {
    const plan = await this.prisma.plan.update({
      where: { id: planId },
      data: { contingencies: contingencies as unknown as object },
    });
    await this.audit.record({
      planId,
      action: AuditAction.AGENT_SET_CONTINGENCIES,
      summary: `Set ${contingencies.length} contingenc${contingencies.length === 1 ? "y" : "ies"}`,
      payload: { contingencies },
      undo: { type: "CLEAR_CONTINGENCIES", planId },
      threadId: plan.threadId,
    });
    if (!opts.silent) await this.broadcastPlan(planId);
    return plan;
  }

  // Enact a contingency (e.g. switch to the backup option). Reversible (RESTORE_LOCKED undo).
  async enactContingency(planId: string, index: number, opts: { actor?: string } = {}) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const list = (plan.contingencies as Contingency[] | null) ?? [];
    const c = list[index];
    if (!c) throw new BadRequestException("no such contingency");
    if (c.type !== "switch_backup" || !c.backupOptionId) {
      // non-actionable contingencies (hold/rebalance) are informational — just announce + audit.
      await this.audit.record({
        planId, actor: opts.actor ?? "plot", action: AuditAction.AGENT_POSTED_MESSAGE,
        summary: `Noted contingency: ${c.thenText}`, payload: { contingency: c }, undo: { type: "NONE" },
        threadId: plan.threadId,
      });
      return this.getPlan(planId);
    }
    const backup = await this.prisma.planOption.findUniqueOrThrow({ where: { id: c.backupOptionId } });
    const prev = { optionId: plan.lockedOptionId, time: plan.lockedTime?.toISOString() ?? null, place: plan.lockedPlace };
    await this.prisma.plan.update({
      where: { id: planId },
      data: { lockedOptionId: backup.id, lockedTime: backup.startsAt ?? plan.lockedTime, lockedPlace: backup.place ?? backup.label },
    });
    const msg = await this.prisma.message.create({
      data: { threadId: plan.threadId, kind: MessageKind.AGENT, planId,
        body: `✦ Contingency enacted — switched to "${backup.label}". ${c.ifText}.` },
    });
    this.realtime.emitToThread(plan.threadId, "message.created", await this.messageDto(msg.id));
    await this.audit.record({
      planId, actor: opts.actor ?? "plot", action: AuditAction.AGENT_LOCKED_PLAN,
      summary: `Enacted contingency → "${backup.label}"`,
      payload: { contingency: c, backupOptionId: backup.id },
      undo: { type: "RESTORE_LOCKED", planId, optionId: prev.optionId ?? null, time: prev.time, place: prev.place ?? null },
      threadId: plan.threadId,
    });
    await this.broadcastPlan(planId);
    return this.getPlan(planId);
  }

  // ── leader selection: highest (up - down); ties broken by earliest start time ──
  private pickLeader(options: { id: string; label: string; place: string | null; startsAt: Date | null; votes: { value: VoteValue }[] }[]) {
    return [...options]
      .map((o) => ({
        o,
        score: o.votes.reduce((s, v) => s + (v.value === VoteValue.UP ? 1 : v.value === VoteValue.DOWN ? -1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score || (a.o.startsAt?.getTime() ?? 0) - (b.o.startsAt?.getTime() ?? 0))
      .map((x) => x.o)[0];
  }

  private bringListFor(label: string, place: string | null): string[] {
    const l = `${label} ${place ?? ""}`.toLowerCase();
    const items = ["Cash for the table", "A good playlist"];
    if (/bar|cocktail|drinks|rooftop/.test(l)) items.push("Your ID");
    if (/pizza|casual|park|picnic/.test(l)) items.push("Napkins", "A blanket");
    if (/thai|italian|dinner|trattoria/.test(l)) items.push("An appetite", "Someone who speaks for the table");
    return items;
  }

  // ── DTO assembly ──
  async getPlan(planId: string) {
    const plan = await this.prisma.plan.findUniqueOrThrow({
      where: { id: planId },
      include: {
        options: { include: { votes: true } },
        rsvps: { include: { user: true, contact: true } },
        bringList: true,
        splits: { include: { shares: { include: { user: true, contact: true } } }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const split = plan.splits[0];
    return {
      id: plan.id,
      title: plan.title,
      state: plan.state,
      lockedOptionId: plan.lockedOptionId ?? undefined,
      lockedTime: plan.lockedTime?.toISOString(),
      lockedPlace: plan.lockedPlace ?? undefined,
      softDeadline: plan.softDeadline?.toISOString(),
      spendCapCents: plan.spendCapCents,
      spentCents: plan.spentCents,
      bookingRef: plan.bookingRef ?? undefined,
      bookingFallback: (plan.bookingFallback as { kind: string; value: string; label: string } | null) ?? undefined,
      split: split
        ? {
            id: split.id,
            state: split.state,
            totalCents: split.totalCents,
            memo: split.memo ?? undefined,
            shares: split.shares.map((s) => ({
              name: s.user?.displayName ?? s.contact?.displayName ?? "?",
              amountCents: s.amountCents,
              paid: s.paid,
              isNonUser: !!s.contactId,
            })),
          }
        : undefined,
      contingencies: (plan.contingencies as Contingency[] | null) ?? [],
      // surpriseMode intentionally NOT serialized into the shared plan payload (§13 #6)
      options: plan.options.map((o) => {
        const meta = (o.metadata as { why?: string; fitFlags?: string[] } | null) ?? null;
        return {
          id: o.id,
          kind: o.kind,
          label: o.label,
          startsAt: o.startsAt?.toISOString(),
          endsAt: o.endsAt?.toISOString(),
          place: o.place ?? undefined,
          priceTier: o.priceTier ?? undefined,
          why: meta?.why ?? undefined,
          fitFlags: meta?.fitFlags ?? undefined,
        };
      }),
      votes: plan.options.map((o) => ({
        optionId: o.id,
        up: o.votes.filter((v) => v.value === VoteValue.UP).length,
        down: o.votes.filter((v) => v.value === VoteValue.DOWN).length,
      })),
      rsvps: plan.rsvps.map((r) => ({
        name: r.user?.displayName ?? r.contact?.displayName ?? "?",
        status: r.status,
      })),
      bringList: plan.bringList.map((b) => ({ id: b.id, label: b.label, generated: b.generated })),
    };
  }

  private async broadcastPlan(planId: string) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    this.realtime.emitToThread(plan.threadId, "plan.updated", await this.getPlan(planId));
  }

  private async messageDto(messageId: string) {
    const m = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { author: true } });
    return {
      id: m.id,
      threadId: m.threadId,
      kind: m.kind,
      body: m.body,
      authorId: m.authorId ?? undefined,
      authorName: m.author?.displayName ?? (m.kind === "AGENT" || m.kind === "DECISION_CARD" ? "Plot" : undefined),
      planId: m.planId ?? undefined,
      metadata: (m.metadata as object) ?? undefined,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
