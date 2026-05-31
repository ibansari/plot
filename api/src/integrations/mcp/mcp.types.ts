// MCP gateway types (Slice 2). The render envelope is the ONLY shape that reaches chat — raw MCP
// JSON never does (§UI Rendering Envelope).

export type McpRisk = "READ" | "WRITE" | "HOLD" | "PURCHASE" | "IRREVERSIBLE";
export type ApprovalPolicy = "none" | "member" | "group" | "organizer";
export type Renderer =
  | "GENERIC" | "LIST" | "COMPARISON" | "MAP" | "WEATHER"
  | "SCHEDULE" | "ITINERARY" | "APPROVAL" | "RECEIPT";

export interface IntegrationRenderEnvelope {
  id: string;
  serverId: string;
  toolName: string;
  capability?: string;
  renderer: Renderer;
  title: string;
  summary?: string;
  freshness?: string;
  attribution?: { label: string; url?: string }[];
  fields?: { label: string; value: string }[];
  items?: {
    id?: string;
    title: string;
    subtitle?: string;
    fields?: { label: string; value: string }[];
    links?: { label: string; url: string }[];
  }[];
  links?: { label: string; url: string }[];
  actions?: { id: string; label: string; style: "PRIMARY" | "SECONDARY" | "DESTRUCTIVE"; approvalId?: string }[];
  risk?: McpRisk;
  status: "READY" | "DEGRADED" | "NEEDS_APPROVAL" | "FAILED";
}

// approval policy per risk (§Transaction Lifecycle):
// read → none; write → member; hold → member; purchase → organizer; irreversible → organizer.
export function approvalPolicyForRisk(risk: McpRisk): ApprovalPolicy {
  switch (risk) {
    case "READ":
      return "none";
    case "WRITE":
    case "HOLD":
      return "member";
    case "PURCHASE":
    case "IRREVERSIBLE":
      return "organizer";
  }
}

// a tool is "known mutating" by name heuristics until the catalog overrides it
const MUTATE_HINTS = ["book", "reserve", "create", "purchase", "buy", "pay", "cancel", "delete", "update", "hold", "checkout"];
const PURCHASE_HINTS = ["purchase", "buy", "pay", "checkout", "ticket"];
const IRREVERSIBLE_HINTS = ["cancel", "delete"];

export function classifyRisk(toolName: string, override?: McpRisk): McpRisk {
  if (override) return override;
  const t = toolName.toLowerCase();
  if (IRREVERSIBLE_HINTS.some((h) => t.includes(h))) return "IRREVERSIBLE";
  if (PURCHASE_HINTS.some((h) => t.includes(h))) return "PURCHASE";
  if (t.includes("book") || t.includes("reserve") || t.includes("hold")) return "HOLD";
  if (MUTATE_HINTS.some((h) => t.includes(h))) return "WRITE";
  return "READ";
}
