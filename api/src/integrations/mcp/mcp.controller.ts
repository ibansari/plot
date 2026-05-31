import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { McpGatewayService } from "./mcp-gateway.service";
import { PrismaService } from "../../common/prisma.service";
import { AuthGuard, AuthedRequest } from "../../common/auth.guard";
import { McpRisk, Renderer } from "./mcp.types";

@UseGuards(AuthGuard)
@Controller()
export class McpController {
  constructor(
    private readonly gateway: McpGatewayService,
    private readonly prisma: PrismaService,
  ) {}

  // ── agent: invoke an MCP tool through the gateway. Reads execute; mutations return a preview. ──
  @Post("internal/mcp/invoke")
  invoke(
    @Body()
    b: {
      serverKey: string;
      toolName: string;
      input?: Record<string, unknown>;
      groupId?: string;
      riskOverride?: McpRisk;
      rendererHint?: Renderer;
      capability?: string;
      preview?: { provider?: string; item?: string; total?: string; policyUrl?: string };
    },
  ) {
    return this.gateway.invoke({ ...b, input: b.input ?? {} });
  }

  // ── member approves a previewed external action; role enforced for organizer-policy actions ──
  @Post("mcp/approvals/:id/approve")
  async approve(@Param("id") id: string, @Req() req: AuthedRequest) {
    const userId = req.userId!;
    const approval = await this.prisma.externalActionApproval.findUniqueOrThrow({ where: { id }, include: { invocation: true } });
    let role = "MEMBER";
    if (approval.invocation.groupId) {
      const m = await this.prisma.groupMember.findFirst({ where: { groupId: approval.invocation.groupId, userId } });
      role = m?.role ?? "MEMBER";
    }
    return this.gateway.approveAndExecute(id, { id: userId, role });
  }

  // ── connector catalog (curated, extensible) ──
  @Get("internal/mcp/catalog")
  async catalog() {
    const entries = await this.prisma.connectorCatalogEntry.findMany({ orderBy: { category: "asc" } });
    return entries.map((e) => ({ key: e.key, displayName: e.displayName, category: e.category, trustTier: e.trustTier, sourceUrl: e.sourceUrl }));
  }
}
