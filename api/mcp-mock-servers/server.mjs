// Bundled mock MCP server, one logical connector per process: `node server.mjs <catalogKey>`.
// Uses the vendored @modelcontextprotocol/sdk (no downloads). Exposes the connector's tools from
// fixtures.mjs over stdio so Plot's real McpStdioExecutor connects to it exactly like any MCP server.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FIXTURES } from "./fixtures.mjs";

const key = process.argv[2];
const spec = FIXTURES[key];
if (!spec) {
  console.error(`plot mock MCP server: unknown connector key '${key}'`);
  process.exit(1);
}

const server = new Server({ name: `plot-mock-${key}`, version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: spec.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = spec.tools.find((t) => t.name === req.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `unknown tool '${req.params.name}'` }] };
  const out = tool.result(req.params.arguments ?? {});
  return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
});

await server.connect(new StdioServerTransport());
