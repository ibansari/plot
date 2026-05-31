import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { PlanService, ProposeOptionInput } from "./plan.service";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../common/prisma.service";
import { AuthGuard, AuthedRequest } from "../common/auth.guard";
import { OptionKind, RsvpStatus, VoteValue } from "@plot/db";

@UseGuards(AuthGuard)
@Controller()
export class PlanController {
  constructor(
    private readonly plans: PlanService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  // ── public (app user) ──
  @Get("plans/:id")
  get(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.plans.getPlan(id, { userId: req.userId });
  }

  @Post("plans/:id/start-vote")
  startVote(@Param("id") id: string) {
    return this.plans.startVoting(id);
  }

  @Post("plans/:id/options")
  addOption(
    @Param("id") id: string,
    @Body() b: { kind?: OptionKind; label: string; startsAt?: string; endsAt?: string; place?: string; priceTier?: number },
  ) {
    return this.plans.addOption(id, { ...b, kind: b.kind ?? OptionKind.ACTIVITY });
  }

  @Delete("plans/:id/options/:optionId")
  removeOption(@Param("id") id: string, @Param("optionId") optionId: string) {
    return this.plans.removeOption(id, optionId);
  }

  @Post("plans/:id/votes")
  vote(@Param("id") id: string, @Req() req: AuthedRequest, @Body() b: { optionId: string; value?: VoteValue }) {
    return this.plans.castVote(id, { userId: req.userId }, b.optionId, b.value ?? VoteValue.UP);
  }

  @Post("plans/:id/rsvp")
  rsvp(@Param("id") id: string, @Req() req: AuthedRequest, @Body() b: { status: RsvpStatus }) {
    return this.plans.setRsvp(id, { userId: req.userId }, b.status);
  }

  @Get("plans/:id/audit")
  async listAudit(@Param("id") id: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { planId: id },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.audit.toDto(r));
  }

  @Post("audit/:auditId/undo")
  undo(@Param("auditId") auditId: string) {
    return this.audit.undo(auditId);
  }

  // organizer books a LOCKED plan (explicit human action → cap-bypassed; books or degrades)
  @Post("plans/:id/book")
  book(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.plans.book(id, { actor: req.userId });
  }

  // enact a self-enforcing contingency (e.g. switch to the backup option); reversible
  @Post("plans/:id/contingencies/:idx/enact")
  enact(@Param("id") id: string, @Param("idx") idx: string, @Req() req: AuthedRequest) {
    return this.plans.enactContingency(id, parseInt(idx, 10), { actor: req.userId });
  }

  // ── internal (agent + inngest, authorized via x-plot-internal header) ──
  @Post("internal/plans/propose")
  propose(
    @Body()
    b: {
      threadId: string;
      groupId: string;
      title: string;
      options: ProposeOptionInput[];
      organizerId?: string;
      spendCapCents?: number;
      surpriseMode?: boolean;
      method?: string;
      summary?: string;
    },
  ) {
    return this.plans.proposeDecision(b);
  }

  @Post("internal/plans/:id/lock")
  lock(@Param("id") id: string, @Body() b: { reason?: string }) {
    return this.plans.lock(id, { actor: "plot", reason: b?.reason });
  }

  @Post("internal/plans/:id/check-spend")
  checkSpend(@Param("id") id: string, @Body() b: { amountCents: number }) {
    return this.plans.checkSpend(id, b.amountCents);
  }
}
