import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { PrismaService } from "../common/prisma.service";
import { RealtimeGateway } from "../common/realtime.gateway";
import { AuditService } from "../common/audit.service";
import { config } from "../common/config";
import { MessageKind, AuditAction } from "@plot/db";

@Injectable()
export class ChatService {
  private readonly log = new Logger("Chat");
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  async listMessages(threadId: string) {
    const msgs = await this.prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      include: { author: true },
    });
    return msgs.map((m) => this.toDto(m));
  }

  // A human posts → persist, broadcast, then trigger the agent graph asynchronously.
  async postMessage(threadId: string, userId: string, body: string) {
    const m = await this.prisma.message.create({
      data: { threadId, authorId: userId, body, kind: MessageKind.TEXT },
      include: { author: true },
    });
    const dto = this.toDto(m);
    this.realtime.emitToThread(threadId, "message.created", dto);
    this.triggerAgent(threadId); // fire-and-forget
    return dto;
  }

  // The agent posts as Plot (internal). kind = AGENT | DECISION_CARD.
  async postAgentMessage(threadId: string, body: string, kind: MessageKind = MessageKind.AGENT, metadata?: object, planId?: string) {
    const m = await this.prisma.message.create({
      data: { threadId, body, kind, metadata, planId },
      include: { author: true },
    });
    const dto = this.toDto(m);
    this.realtime.emitToThread(threadId, "message.created", dto);
    await this.audit.record({
      planId,
      action: AuditAction.AGENT_POSTED_MESSAGE,
      summary: `Plot posted: "${body.slice(0, 60)}"`,
      payload: { messageId: m.id },
      undo: { type: "DELETE_MESSAGE", messageId: m.id },
      threadId,
    });
    return dto;
  }

  async actOnPlotSuggestion(threadId: string, messageId: string, userId: string, action: "draft_options" | "dismiss") {
    const message = await this.prisma.message.findFirstOrThrow({
      where: { id: messageId, threadId, kind: MessageKind.AGENT },
      include: { author: true },
    });
    const metadata = ((message.metadata as Record<string, unknown> | null) ?? {});
    if (metadata.kind !== "plot_suggestion") throw new BadRequestException("message is not a Plot suggestion");
    if (metadata.status && metadata.status !== "open") throw new BadRequestException("suggestion already handled");

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, status: action === "draft_options" ? "accepted" : "dismissed", actedBy: userId } },
      include: { author: true },
    });
    const dto = this.toDto(updated);
    this.realtime.emitToThread(threadId, "message.updated", dto);
    if (action === "draft_options") this.triggerAgent(threadId, "confirmed_intent");
    return dto;
  }

  // Context bundle the agent's graph reads at the start of a run.
  async context(threadId: string) {
    const thread = await this.prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: thread.groupId },
      include: { user: true, contact: true },
    });
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      take: 40,
      include: { author: true },
    });
    const organizer = members.find((m) => m.role === "ORGANIZER");
    return {
      threadId,
      groupId: thread.groupId,
      organizerId: organizer?.userId ?? undefined,
      members: members.map((m) => ({
        memberId: m.id,
        name: m.user?.displayName ?? m.contact?.displayName ?? "?",
        userId: m.userId ?? undefined,
        contactId: m.contactId ?? undefined,
        isNonUser: !!m.contactId,
        // constraint memory the agent applies when ranking/flagging options (§A7)
        constraints: (m.constraints as unknown[] | null) ?? [],
      })),
      messages: messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        body: m.body,
        authorName: m.author?.displayName ?? (m.kind === "AGENT" ? "Plot" : undefined),
        isAgent: m.kind === MessageKind.AGENT || m.kind === MessageKind.DECISION_CARD,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  private async triggerAgent(threadId: string, trigger = "message") {
    try {
      await axios.post(`${config.agentBaseUrl}/run`, { threadId, trigger }, { timeout: 30_000 });
    } catch (e) {
      // graceful: chat still works if the agent service is down; it just won't respond.
      this.log.warn(`agent trigger failed (chat continues): ${(e as Error).message}`);
    }
  }

  private toDto(m: { id: string; threadId: string; kind: MessageKind; body: string; authorId: string | null; author?: { displayName: string } | null; planId: string | null; metadata: unknown; createdAt: Date }) {
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
