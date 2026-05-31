import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../common/prisma.service";
import { AuditService } from "../common/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PlanService } from "../plan/plan.service";
import { config } from "../common/config";
import { AuditAction, RsvpStatus, VoteValue } from "@plot/db";

// The non-user bridge: issues a signed, single-purpose link to a Contact and sends it over SMS
// (mock logs it). The Contact opens /web, and their vote/RSVP is reconciled back into the plan.
@Injectable()
export class NonUserGatewayService {
  private readonly log = new Logger("NonUserGateway");
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotificationsService,
    private readonly plans: PlanService,
  ) {}

  private sign(parts: string[]): string {
    return crypto.createHmac("sha256", config.linkSigningSecret).update(parts.join("|")).digest("hex").slice(0, 32);
  }

  // Issue a link + send the SMS. Used by the agent's send-nonuser-invite tool.
  async invite(planId: string, contactId: string, purpose: "vote" | "rsvp" | "pay" = "vote") {
    const contact = await this.prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    const id = crypto.randomUUID();
    const signature = this.sign([id, contactId, planId, purpose]);
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const token = await this.prisma.nonUserToken.create({
      data: { id, contactId, planId, purpose, signature, expiresAt },
    });
    const link = `${config.webBaseUrl}/v/${token.id}?s=${signature}`;
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: planId } });

    const prompt = purpose === "rsvp"
      ? `✦ Plot: "${plan.title}" is locked. Can you make it? RSVP here (no app needed):\n${link}`
      : `✦ Plot: the crew is planning "${plan.title}". Tap to weigh in (no app needed):\n${link}`;
    await this.notify.sendSms(contact.phone, prompt);

    await this.audit.record({
      planId,
      action: AuditAction.AGENT_SENT_NONUSER_INVITE,
      summary: `Texted ${contact.displayName} a ${purpose} link`,
      payload: { contactId, link },
      undo: { type: "REVOKE_NONUSER_TOKEN", tokenId: token.id },
    });
    return { tokenId: token.id, link };
  }

  // Validate a token presented by the web page. Throws on tamper/expiry/revocation.
  private async validate(tokenId: string, sig: string) {
    const token = await this.prisma.nonUserToken.findUnique({ where: { id: tokenId } });
    if (!token) throw new BadRequestException("invalid link");
    if (token.usedAt && token.usedAt.getTime() === 0) throw new BadRequestException("link revoked");
    if (token.expiresAt < new Date()) throw new BadRequestException("link expired");
    const expected = this.sign([token.id, token.contactId, token.planId, token.purpose]);
    if (sig !== expected) throw new BadRequestException("bad signature");
    return token;
  }

  // Data the web vote page renders.
  async pageData(tokenId: string, sig: string) {
    const token = await this.validate(tokenId, sig);
    const contact = await this.prisma.contact.findUniqueOrThrow({ where: { id: token.contactId } });
    const plan = await this.plans.getPlan(token.planId, { contactId: token.contactId });
    return { purpose: token.purpose, contactName: contact.displayName, plan };
  }

  // Reconcile a non-user vote back into the plan (records viaToken for provenance).
  async vote(tokenId: string, sig: string, optionId: string, value: VoteValue = VoteValue.UP) {
    const token = await this.validate(tokenId, sig);
    await this.prisma.nonUserToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    const plan = await this.plans.castVote(
      token.planId,
      { contactId: token.contactId, viaToken: token.id },
      optionId,
      value,
    );
    this.log.log(`reconciled non-user vote (contact ${token.contactId}) on plan ${token.planId}`);
    return plan;
  }

  async rsvp(tokenId: string, sig: string, status: RsvpStatus) {
    const token = await this.validate(tokenId, sig);
    return this.plans.setRsvp(token.planId, { contactId: token.contactId }, status);
  }
}
