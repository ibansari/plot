import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { McpStdioExecutor } from "./mcp-stdio.executor";
import { MCP_EXECUTOR } from "./mcp-gateway.service";
import { approvalPolicyForRisk, classifyRisk } from "./mcp.types";

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

    const conn = await this.prisma.connectorConnection.create({
      data: {
        catalogKey: opts.catalogKey,
        ownerScope: opts.ownerScope ?? "GROUP",
        groupId: opts.groupId,
        userId: opts.userId,
        transport: opts.transport,
        health,
        coverage: tools.length ? "available" : "degraded",
        lastProbeAt: new Date(),
        tools: {
          create: tools.map((t) => {
            const risk = classifyRisk(t.name);
            return {
              toolName: t.name,
              inputSchema: (t.inputSchema as object) ?? undefined,
              mutate: risk !== "READ",
              risk,
              approvalPolicy: approvalPolicyForRisk(risk),
            };
          }),
        },
      },
      include: { tools: true },
    });
    return {
      connectionId: conn.id,
      health: conn.health,
      tools: conn.tools.map((t) => ({ name: t.toolName, risk: t.risk, approvalPolicy: t.approvalPolicy })),
    };
  }
}
