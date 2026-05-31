import { Injectable } from "@nestjs/common";
import { IntegrationRenderEnvelope, McpRisk, Renderer } from "./mcp.types";

// Turns an arbitrary MCP tool result into a safe IntegrationRenderEnvelope. This is the guarantee
// that raw provider JSON never reaches chat: every result becomes coherent key-value / list / link
// cards (the GENERIC rung of the rendering ladder), with attribution and freshness when present.
// Higher renderers (MAP, WEATHER, RECEIPT…) are selected by a connector/tool hint.
@Injectable()
export class McpRenderService {
  private id() {
    // deterministic-ish id without Date (cuid-style enough for an envelope handle)
    return "env_" + Math.random().toString(36).slice(2, 10);
  }

  result(opts: {
    serverId: string;
    toolName: string;
    output: unknown;
    rendererHint?: Renderer;
    capability?: string;
    attribution?: { label: string; url?: string }[];
    freshness?: string;
    risk?: McpRisk;
    degraded?: boolean;
  }): IntegrationRenderEnvelope {
    const base: IntegrationRenderEnvelope = {
      id: this.id(),
      serverId: opts.serverId,
      toolName: opts.toolName,
      capability: opts.capability,
      renderer: opts.rendererHint ?? "GENERIC",
      title: this.titleize(opts.toolName),
      attribution: opts.attribution,
      freshness: opts.freshness,
      risk: opts.risk,
      status: opts.degraded ? "DEGRADED" : "READY",
    };

    const parsed = this.coerce(opts.output);

    if (Array.isArray(parsed)) {
      base.renderer = opts.rendererHint ?? "LIST";
      base.items = parsed.slice(0, 12).map((row) => this.toItem(row));
      base.summary = `${parsed.length} result${parsed.length === 1 ? "" : "s"}`;
      return base;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.items)) {
        base.renderer = opts.rendererHint ?? "LIST";
        base.items = (obj.items as unknown[]).slice(0, 12).map((row) => this.toItem(row));
      }
      base.fields = this.toFields(obj);
      base.links = this.extractLinks(obj);
      if (typeof obj.summary === "string") base.summary = obj.summary;
      return base;
    }
    // primitive / text
    base.summary = typeof parsed === "string" ? parsed.slice(0, 600) : String(parsed);
    return base;
  }

  error(serverId: string, toolName: string, message: string): IntegrationRenderEnvelope {
    return {
      id: this.id(),
      serverId,
      toolName,
      renderer: "GENERIC",
      title: this.titleize(toolName),
      summary: message.slice(0, 300),
      status: "FAILED",
    };
  }

  approval(opts: {
    serverId: string;
    toolName: string;
    risk: McpRisk;
    approvalId: string;
    preview: { provider?: string; item?: string; total?: string; policy: string; cannotUndo?: boolean; policyUrl?: string };
  }): IntegrationRenderEnvelope {
    const { preview, risk } = opts;
    const fields: { label: string; value: string }[] = [];
    if (preview.provider) fields.push({ label: "Provider", value: preview.provider });
    if (preview.item) fields.push({ label: "Item", value: preview.item });
    if (preview.total) fields.push({ label: "Total", value: preview.total });
    fields.push({ label: "Approval", value: preview.policy });
    fields.push({ label: "Risk", value: risk });
    if (preview.cannotUndo) fields.push({ label: "Warning", value: "Plot cannot undo this action." });
    const links = preview.policyUrl ? [{ label: "Provider policy", url: preview.policyUrl }] : undefined;
    return {
      id: this.id(),
      serverId: opts.serverId,
      toolName: opts.toolName,
      renderer: "APPROVAL",
      title: `Approve: ${this.titleize(opts.toolName)}`,
      fields,
      links,
      risk,
      status: "NEEDS_APPROVAL",
      actions: [
        { id: "approve", label: preview.cannotUndo ? "Approve (cannot undo)" : "Approve", style: preview.cannotUndo ? "DESTRUCTIVE" : "PRIMARY", approvalId: opts.approvalId },
        { id: "reject", label: "Not now", style: "SECONDARY", approvalId: opts.approvalId },
      ],
    };
  }

  receipt(opts: { serverId: string; toolName: string; confirmation?: string; policyUrl?: string; cancellable: boolean; fallbackUrl?: string }): IntegrationRenderEnvelope {
    const fields: { label: string; value: string }[] = [];
    if (opts.confirmation) fields.push({ label: "Confirmation", value: opts.confirmation });
    fields.push({ label: "Cancellable", value: opts.cancellable ? "Yes" : "No — Plot cannot undo this" });
    const links = [
      ...(opts.policyUrl ? [{ label: "Provider policy", url: opts.policyUrl }] : []),
      ...(opts.fallbackUrl ? [{ label: "Open with provider", url: opts.fallbackUrl }] : []),
    ];
    return {
      id: this.id(),
      serverId: opts.serverId,
      toolName: opts.toolName,
      renderer: "RECEIPT",
      title: `Done: ${this.titleize(opts.toolName)}`,
      fields,
      links: links.length ? links : undefined,
      status: "READY",
    };
  }

  // ── helpers ──
  private coerce(output: unknown): unknown {
    // MCP tool results often arrive as {content: "<text or json string>"}
    if (output && typeof output === "object" && "content" in (output as any)) {
      const c = (output as any).content;
      if (typeof c === "string") {
        try {
          return JSON.parse(c);
        } catch {
          return c;
        }
      }
      return c;
    }
    if (typeof output === "string") {
      try {
        return JSON.parse(output);
      } catch {
        return output;
      }
    }
    return output;
  }

  private toItem(row: unknown) {
    if (row && typeof row === "object") {
      const o = row as Record<string, unknown>;
      const title = String(o.title ?? o.name ?? o.displayName ?? o.id ?? "Item");
      return {
        id: o.id ? String(o.id) : undefined,
        title,
        subtitle: o.subtitle ? String(o.subtitle) : o.address ? String(o.address) : undefined,
        fields: this.toFields(o, ["title", "name", "displayName", "subtitle", "address", "id", "url", "link"]),
        links: this.extractLinks(o),
      };
    }
    return { title: String(row) };
  }

  private toFields(obj: Record<string, unknown>, skip: string[] = []): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (skip.includes(k) || k === "items" || k === "summary") continue;
      if (v == null || typeof v === "object") continue; // only scalars become fields (no nested JSON dump)
      out.push({ label: this.titleize(k), value: String(v) });
      if (out.length >= 10) break;
    }
    return out;
  }

  private extractLinks(obj: Record<string, unknown>): { label: string; url: string }[] | undefined {
    const links: { label: string; url: string }[] = [];
    for (const key of ["url", "link", "websiteUri", "bookingUrl", "mapUrl"]) {
      const v = obj[key];
      if (typeof v === "string" && v.startsWith("http")) links.push({ label: this.titleize(key), url: v });
    }
    return links.length ? links : undefined;
  }

  private titleize(s: string): string {
    return s.replace(/[_\-.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
}
