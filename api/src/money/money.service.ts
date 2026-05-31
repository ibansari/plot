import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { SplitState } from "@plot/db";
import { PAYMENT_PROVIDER, PaymentProvider } from "./payment.provider";

// Even-split + escrow over a plan. Exercised by the mock today; real behind StripeConnectProvider.
@Injectable()
export class MoneyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly pay: PaymentProvider,
  ) {}

  // Create an even split across the plan's members and hold the total in escrow.
  async createEvenSplit(planId: string, totalCents: number, memo: string) {
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });
    const members = await this.prisma.groupMember.findMany({ where: { groupId: plan.groupId } });
    const n = Math.max(members.length, 1);
    const per = Math.floor(totalCents / n);

    const hold = await this.pay.hold(totalCents, memo);
    const split = await this.prisma.split.create({
      data: {
        planId,
        totalCents,
        memo,
        state: SplitState.HELD,
        externalRef: hold.externalRef,
        shares: {
          create: members.map((m) => ({
            amountCents: per,
            userId: m.userId ?? undefined,
            contactId: m.contactId ?? undefined,
          })),
        },
      },
      include: { shares: true },
    });
    return split;
  }

  // The latest split for a plan, with per-share paid status (what the Money sheet renders).
  async getSplit(planId: string) {
    const split = await this.prisma.split.findFirst({
      where: { planId },
      orderBy: { createdAt: "desc" },
      include: { shares: { include: { user: true, contact: true } } },
    });
    if (!split) return null;
    return {
      id: split.id,
      state: split.state,
      totalCents: split.totalCents,
      memo: split.memo ?? undefined,
      shares: split.shares.map((s) => ({
        id: s.id,
        name: s.user?.displayName ?? s.contact?.displayName ?? "?",
        amountCents: s.amountCents,
        paid: s.paid,
        isNonUser: !!s.contactId,
      })),
    };
  }

  // Mark a participant's share paid. When every share is in, capture the escrow hold.
  async payShare(opts: { splitId: string; userId?: string; contactId?: string }) {
    const where = opts.userId
      ? { splitId: opts.splitId, userId: opts.userId }
      : { splitId: opts.splitId, contactId: opts.contactId };
    await this.prisma.splitShare.updateMany({ where, data: { paid: true } });
    const remaining = await this.prisma.splitShare.count({ where: { splitId: opts.splitId, paid: false } });
    if (remaining === 0) await this.capture(opts.splitId);
    return this.getSplitById(opts.splitId);
  }

  private async getSplitById(splitId: string) {
    const s = await this.prisma.split.findUniqueOrThrow({ where: { id: splitId } });
    return this.getSplit(s.planId);
  }

  async capture(splitId: string) {
    const split = await this.prisma.split.findUniqueOrThrow({ where: { id: splitId } });
    if (split.externalRef) await this.pay.capture(split.externalRef);
    return this.prisma.split.update({ where: { id: splitId }, data: { state: SplitState.CAPTURED } });
  }

  async refund(splitId: string) {
    const split = await this.prisma.split.findUniqueOrThrow({ where: { id: splitId } });
    if (split.externalRef) await this.pay.refund(split.externalRef);
    return this.prisma.split.update({ where: { id: splitId }, data: { state: SplitState.REFUNDED } });
  }
}
