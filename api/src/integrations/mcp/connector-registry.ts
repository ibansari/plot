import { existsSync } from "fs";
import { join, resolve } from "path";

// Maps a catalog key to the MCP server transport that backs it. Today every entry points at a
// bundled mock server (api/mcp-mock-servers/server.mjs <key>) so connectors are functional with no
// external credentials or downloads; swapping in a real server later is a one-line transport change.
export interface ConnectorRegistryEntry {
  serverKey: string;
  transport: { transport: "stdio"; command: string; args: string[] };
}

// Resolve the bundled mock server script. The API runs with cwd=api/ (pnpm --filter @plot/api),
// and jest's rootDir is api/ too — but fall back through dist/src-relative candidates to be robust.
function mockServerPath(): string {
  const candidates = [
    process.env.PLOT_MCP_MOCK_DIR ? join(process.env.PLOT_MCP_MOCK_DIR, "server.mjs") : undefined,
    resolve(process.cwd(), "mcp-mock-servers", "server.mjs"),
    resolve(__dirname, "../../../mcp-mock-servers/server.mjs"), // dist/integrations/mcp → api/
    resolve(__dirname, "../../../../mcp-mock-servers/server.mjs"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? candidates[1];
}

// Connectors that are backed by a bundled mock MCP server (weatherkit stays native, not MCP).
const MOCK_CONNECTORS = ["google-calendar", "google-maps", "resy", "ticketmaster", "flights", "lodging"];

export function connectorRegistryEntry(catalogKey: string): ConnectorRegistryEntry | null {
  if (!MOCK_CONNECTORS.includes(catalogKey)) return null;
  return {
    serverKey: `mock-${catalogKey}`,
    transport: { transport: "stdio", command: process.execPath, args: [mockServerPath(), catalogKey] },
  };
}

export function isConnectable(catalogKey: string): boolean {
  return MOCK_CONNECTORS.includes(catalogKey);
}
