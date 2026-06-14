import { Injectable, Logger } from "@nestjs/common";
import { McpExecutor } from "./mcp-gateway.service";

type TransportCfg =
  | { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { transport: "http"; url: string; headers?: Record<string, string> };

interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

// Real MCP client transport behind the gateway's executor seam. Connects to a configured server
// (stdio or streamable-http), caches the session per server key, and calls tools. The MCP SDK is
// ESM-only, so it's loaded via dynamic import() to stay compatible with the CommonJS Nest build.
// Server transport configs come from PLOT_MCP_SERVERS (JSON) or are passed explicitly on connect.
@Injectable()
export class McpStdioExecutor implements McpExecutor {
  private readonly log = new Logger("McpExecutor");
  private clients = new Map<string, any>();
  private configs = new Map<string, TransportCfg>();

  constructor() {
    try {
      const raw = process.env.PLOT_MCP_SERVERS;
      if (raw) for (const s of JSON.parse(raw)) this.configs.set(s.name ?? s.key, s);
    } catch {
      /* ignore malformed config */
    }
  }

  register(serverKey: string, cfg: TransportCfg) {
    // (Re)connecting refreshes the transport — drop any cached session so the next call dials the
    // server described by the latest config rather than reusing a stale (possibly closed) one.
    this.evict(serverKey);
    this.configs.set(serverKey, cfg);
  }

  // Close + forget a server's cached session (used on reconnect and disconnect). Best-effort.
  evict(serverKey: string) {
    const c = this.clients.get(serverKey);
    if (c) {
      this.clients.delete(serverKey);
      Promise.resolve(c.close?.()).catch(() => {});
    }
  }

  private async client(serverKey: string): Promise<any | null> {
    if (this.clients.has(serverKey)) return this.clients.get(serverKey);
    const cfg = this.configs.get(serverKey);
    if (!cfg) return null;
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      let transport: any;
      if (cfg.transport === "http") {
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });
      } else {
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
        transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: { ...baseEnv, ...(cfg.env ?? {}) } });
      }
      const c = new Client({ name: "plot-gateway", version: "1.0.0" }, { capabilities: {} });
      await c.connect(transport);
      this.clients.set(serverKey, c);
      this.log.log(`MCP connected: ${serverKey}`);
      return c;
    } catch (e) {
      this.log.warn(`MCP connect failed for ${serverKey}: ${(e as Error).message}`);
      return null;
    }
  }

  async listTools(serverKey: string): Promise<DiscoveredTool[]> {
    const c = await this.client(serverKey);
    if (!c) return [];
    const res = await c.listTools();
    return (res.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }

  async call(serverKey: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const c = await this.client(serverKey);
    if (!c) throw new Error(`MCP server '${serverKey}' not connected`);
    const res = await c.callTool({ name: toolName, arguments: args ?? {} });
    const parts = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text);
    if (res.isError) throw new Error(parts.join("\n") || "tool error");
    return { content: parts.join("\n") || JSON.stringify(res.structuredContent ?? res) };
  }
}
