import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { McpStdioExecutor } from "./mcp-stdio.executor";
import { MCP_EXECUTOR } from "./mcp-gateway.service";
import { approvalPolicyForRisk, classifyRisk } from "./mcp.types";
import { connectorRegistryEntry } from "./connector-registry";

// Connect a catalog connector, discover its tools, and persist them (ConnectorConnection +
// ConnectorTool) with risk + approval policy classified per tool. This is the "API-backed catalog
// connection" the spec moves toward; the agent loop reads these instead of env-only config.
@Injectable()
export class McpConnectionService {
  private readonly log = new Logger("McpConnection");
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MCP_EXECUTOR) private readonly executor: McpStdioExecutor,
  ) {}

  async connectAndDiscover(opts: {
    catalogKey: string;
    serverKey: string;
    transport: any; // stdio/http cfg
    ownerScope?: "MEMBER" | "GROUP";
    groupId?: string;
    userId?: string;
  }) {
    this.executor.register(opts.serverKey, opts.transport);
    let tools: { name: string; description?: string; inputSchema?: unknown }[] = [];
    let health = "ok";
    try {
      tools = await this.executor.listTools(opts.serverKey);
    } catch (e) {
      health = "down";
      this.log.warn(`discover failed for ${opts.serverKey}: ${(e as Error).message}`);
    }
    const coverage = tools.length ? "available" : "degraded";

    // Upsert by (catalogKey, groupId): re-connecting a connector refreshes it instead of stacking
    // duplicate rows. Tools are replaced wholesale so risk/approval reflect the latest discovery.
    const existing = await this.prisma.connectorConnection.findFirst({
      where: { catalogKey: opts.catalogKey, groupId: opts.groupId ?? null },
    });
    const toolData = tools.map((t) => {
      const risk = classifyRisk(t.name);
      return {
        toolName: t.name,
        inputSchema: (t.inputSchema as object) ?? undefined,
        mutate: risk !== "READ",
        risk,
        approvalPolicy: approvalPolicyForRisk(risk),
      };
    });

    let conn;
    if (existing) {
      await this.prisma.connectorTool.deleteMany({ where: { connectionId: existing.id } });
      conn = await this.prisma.connectorConnection.update({
        where: { id: existing.id },
        data: {
          transport: opts.transport,
          health,
          coverage,
          lastProbeAt: new Date(),
          tools: { create: toolData },
        },
        include: { tools: true },
      });
    } else {
      conn = await this.prisma.connectorConnection.create({
        data: {
          catalogKey: opts.catalogKey,
          ownerScope: opts.ownerScope ?? "GROUP",
          groupId: opts.groupId,
          userId: opts.userId,
          transport: opts.transport,
          health,
          coverage,
          lastProbeAt: new Date(),
          tools: { create: toolData },
        },
        include: { tools: true },
      });
    }
    return {
      connectionId: conn.id,
      catalogKey: conn.catalogKey,
      health: conn.health,
      coverage: conn.coverage,
      tools: conn.tools.map((t) => ({ name: t.toolName, risk: t.risk, approvalPolicy: t.approvalPolicy })),
    };
  }

  // Per-group connection state for every catalog connection (used to render connected badges).
  async listForGroup(groupId: string) {
    const conns = await this.prisma.connectorConnection.findMany({
      where: { groupId },
      include: { tools: true },
    });
    return conns.map((c) => ({
      catalogKey: c.catalogKey,
      connected: true,
      health: c.health,
      coverage: c.coverage,
      toolCount: c.tools.length,
    }));
  }

  // Disconnect a group's connector: drop its tools + the connection row. Idempotent.
  async disconnect(catalogKey: string, groupId: string) {
    const existing = await this.prisma.connectorConnection.findFirst({ where: { catalogKey, groupId } });
    if (!existing) return { disconnected: false };
    await this.prisma.connectorTool.deleteMany({ where: { connectionId: existing.id } });
    await this.prisma.connectorConnection.delete({ where: { id: existing.id } });
    this.executor.evict(connectorRegistryEntry(catalogKey)?.serverKey ?? `mock-${catalogKey}`);
    return { disconnected: true };
  }
}
