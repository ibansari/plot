import { McpRenderService } from "../src/integrations/mcp/mcp-render.service";
import { classifyRisk, approvalPolicyForRisk } from "../src/integrations/mcp/mcp.types";

// §UI Rendering Envelope: raw MCP JSON never reaches chat — it becomes a coherent generic card.
describe("McpRenderService (generic renderer)", () => {
  const r = new McpRenderService();

  it("renders a list result as items, never a raw JSON blob", () => {
    const env = r.result({
      serverId: "resy",
      toolName: "search_restaurants",
      output: { content: JSON.stringify([{ name: "Yopparai", rating: 4.6, url: "https://resy.com/x" }, { name: "Toriya", rating: 4.4 }]) },
      attribution: [{ label: "Resy" }],
    });
    expect(env.renderer).toBe("LIST");
    expect(env.items![0].title).toBe("Yopparai");
    expect(env.items![0].fields!.some((f) => f.label === "Rating")).toBe(true);
    expect(env.items![0].links![0].url).toBe("https://resy.com/x");
    expect(env.status).toBe("READY");
    // the envelope is structured fields/items — no stringified JSON dumped into a summary
    expect(env.summary ?? "").not.toMatch(/[{[]"/);
  });

  it("renders an error result as a FAILED card", () => {
    const env = r.error("maps", "geocode", "API key invalid");
    expect(env.status).toBe("FAILED");
    expect(env.summary).toContain("API key invalid");
  });

  it("renders an approval preview with risk + cannot-undo for irreversible actions", () => {
    const env = r.approval({
      serverId: "tickets",
      toolName: "purchase_tickets",
      risk: "IRREVERSIBLE",
      approvalId: "ap1",
      preview: { provider: "Ticketmaster", item: "2x GA", total: "$120", policy: "organizer", cannotUndo: true, policyUrl: "https://tm.com/policy" },
    });
    expect(env.renderer).toBe("APPROVAL");
    expect(env.status).toBe("NEEDS_APPROVAL");
    expect(env.fields!.some((f) => /cannot undo/i.test(f.value))).toBe(true);
    expect(env.actions![0].style).toBe("DESTRUCTIVE");
    expect(env.links![0].url).toContain("tm.com");
  });
});

describe("risk classification + approval policy (§Transaction Lifecycle)", () => {
  it("classifies tool names into risk tiers", () => {
    expect(classifyRisk("search_restaurants")).toBe("READ");
    expect(classifyRisk("book_reservation")).toBe("HOLD");
    expect(classifyRisk("purchase_tickets")).toBe("PURCHASE");
    expect(classifyRisk("cancel_booking")).toBe("IRREVERSIBLE");
    expect(classifyRisk("create_event")).toBe("WRITE");
  });

  it("maps risk → approval policy", () => {
    expect(approvalPolicyForRisk("READ")).toBe("none");
    expect(approvalPolicyForRisk("WRITE")).toBe("member");
    expect(approvalPolicyForRisk("HOLD")).toBe("member"); // free holds: any member
    expect(approvalPolicyForRisk("PURCHASE")).toBe("organizer"); // paid: organizer
    expect(approvalPolicyForRisk("IRREVERSIBLE")).toBe("organizer");
  });
});
