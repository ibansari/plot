import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { AuthGuard, AuthedRequest } from "../common/auth.guard";
import { MessageKind } from "@plot/db";

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @UseGuards(AuthGuard)
  @Get("threads/:id/messages")
  list(@Param("id") id: string) {
    return this.chat.listMessages(id);
  }

  @UseGuards(AuthGuard)
  @Post("threads/:id/messages")
  post(@Param("id") id: string, @Req() req: AuthedRequest, @Body() b: { body: string }) {
    return this.chat.postMessage(id, req.userId!, b.body);
  }

  @UseGuards(AuthGuard)
  @Post("threads/:id/plot-suggestions/:messageId/actions")
  plotSuggestionAction(
    @Param("id") id: string,
    @Param("messageId") messageId: string,
    @Req() req: AuthedRequest,
    @Body() b: { action: "draft_options" | "dismiss" },
  ) {
    return this.chat.actOnPlotSuggestion(id, messageId, req.userId!, b.action);
  }

  // ── internal (agent) ──
  @UseGuards(AuthGuard)
  @Get("internal/threads/:id/context")
  context(@Param("id") id: string) {
    return this.chat.context(id);
  }

  @UseGuards(AuthGuard)
  @Post("internal/threads/:id/agent-message")
  agentMessage(
    @Param("id") id: string,
    @Body() b: { body: string; kind?: MessageKind; metadata?: object; planId?: string },
  ) {
    return this.chat.postAgentMessage(id, b.body, b.kind ?? MessageKind.AGENT, b.metadata, b.planId);
  }
}
