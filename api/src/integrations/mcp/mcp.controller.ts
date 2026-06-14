import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { McpGatewayService } from "./mcp-gateway.service";
import { McpConnectionService } from "./mcp-connection.service";
import { PrismaService } from "../../common/prisma.service";
import { AuthGuard, AuthedRequest } from "../../common/auth.guard";
import { McpRisk, Renderer } from "./mcp.types";
import { connectorRegistryEntry } from "./connector-registry";

@UseGuards(AuthGuard)
@Controller()
export class McpController {
  constructor(
    private readonly gateway: McpGatewayService,
    private readonly connections: McpConnectionService,
    private readonly prisma: PrismaService,
  ) {}

  // ── enable a connector: connect to its MCP server + discover/persist its tools (risk-classified) ──
  @Post("internal/mcp/connect")
  connect(@Body() b: { catalogKey: string; serverKey: string; transport: object; groupId?: string; ownerScope?: "MEMBER" | "GROUP" }) {
    return this.connections.connectAndDiscover(b as never);
  }

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

  // ── user-facing connector management (group-scoped; any member can connect/disconnect) ──

  // catalog merged with this group's live connection state (connected / health / coverage / tools)
  @Get("mcp/connectors")
  async connectors(@Query("groupId") groupId: string, @Req() req: AuthedRequest) {
    await this.assertMember(groupId, req.userId!);
    const entries = await this.prisma.connectorCatalogEntry.findMany({ orderBy: { category: "asc" } });
    const states = await this.connections.listForGroup(groupId);
    const byKey = new Map(states.map((s) => [s.catalogKey, s]));
    return entries.map((e) => {
      const s = byKey.get(e.key);
      return {
        key: e.key,
        displayName: e.displayName,
        category: e.category,
        trustTier: e.trustTier,
        sourceUrl: e.sourceUrl,
        connectable: !!connectorRegistryEntry(e.key),
        connection: s ? { connected: true, health: s.health, coverage: s.coverage, toolCount: s.toolCount } : null,
      };
    });
  }

  // connect a connector for the group: look up its (mock) MCP server, discover + persist its tools
  @Post("mcp/connectors/:key/connect")
  async connectConnector(@Param("key") key: string, @Body() b: { groupId: string }, @Req() req: AuthedRequest) {
    await this.assertMember(b.groupId, req.userId!);
    const reg = connectorRegistryEntry(key);
    if (!reg) throw new NotFoundException(`connector '${key}' is not connectable`);
    return this.connections.connectAndDiscover({
      catalogKey: key,
      serverKey: reg.serverKey,
      transport: reg.transport,
      ownerScope: "GROUP",
      groupId: b.groupId,
    });
  }

  @Post("mcp/connectors/:key/disconnect")
  async disconnect(@Param("key") key: string, @Body() b: { groupId: string }, @Req() req: AuthedRequest) {
    await this.assertMember(b.groupId, req.userId!);
    return this.connections.disconnect(key, b.groupId);
  }

  private async assertMember(groupId: string, userId: string) {
    if (!groupId) throw new NotFoundException("groupId required");
    const m = await this.prisma.groupMember.findFirst({ where: { groupId, userId } });
    if (!m) throw new ForbiddenException("not a member of this group");
  }
}
