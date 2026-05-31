import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AuditService } from "../../common/audit.service";
import { McpRenderService } from "./mcp-render.service";
import { approvalPolicyForRisk, classifyRisk, IntegrationRenderEnvelope, McpRisk, Renderer } from "./mcp.types";

// Executes a discovered MCP tool. The transport lives behind this seam so the gateway's safety
// lifecycle is testable offline (tests inject a fake) and a real MCP client can be wired later.
export interface McpExecutor {
  call(serverKey: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
export const MCP_EXECUTOR = Symbol("MCP_EXECUTOR");

// keys that must never be persisted into invocation input/output or audit (§Privacy).
const SENSITIVE = /token|authorization|secret|credential|password|apikey|api_key|cookie|origin|lat|lng|latitude|longitude|coord/i;

@Injectable()
export class McpGatewayService {
  private readonly log = new Logger("McpGateway");
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: McpRenderService,
    private readonly audit: AuditService,
    @Optional() @Inject(MCP_EXECUTOR) private readonly executor?: McpExecutor,
  ) {}

  private sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE.test(k) ? "[redacted]" : this.sanitize(v);
      }
      return out;
    }
    return value;
  }

  // Agent entry point. Read tools execute immediately and return a render envelope; mutating tools
  // create a preview + approval and return a NEEDS_APPROVAL envelope WITHOUT executing.
  async invoke(opts: {
    serverKey: string;
    toolName: string;
    input: Record<string, unknown>;
    groupId?: string;
    actor?: string;
    riskOverride?: McpRisk;
    rendererHint?: Renderer;
    capability?: string;
    attribution?: { label: string; url?: string }[];
    preview?: { provider?: string; item?: string; total?: string; policyUrl?: string };
  }): Promise<{ status: string; envelope: IntegrationRenderEnvelope; invocationId: string; approvalId?: string }> {
    const risk = classifyRisk(opts.toolName, opts.riskOverride);
    const policy = approvalPolicyForRisk(risk);
    const inv = await this.prisma.integrationInvocation.create({
      data: {
        actor: opts.actor ?? "plot",
        groupId: opts.groupId,
        serverKey: opts.serverKey,
        toolName: opts.toolName,
        sanitizedInput: this.sanitize(opts.input) as object,
        risk,
        status: policy === "none" ? "READY" : "NEEDS_APPROVAL",
      },
    });

    if (policy === "none") {
      // read-only: execute now
      return this.execute(inv.id, opts.serverKey, opts.toolName, opts.input, {
        rendererHint: opts.rendererHint, capability: opts.capability, attribution: opts.attribution, risk,
      });
    }

    // mutation: preview + approval, do NOT execute
    const cannotUndo = risk === "IRREVERSIBLE";
    const approval = await this.prisma.externalActionApproval.create({
      data: {
        invocationId: inv.id,
        policy,
        preview: { provider: opts.preview?.provider, item: opts.preview?.item, total: opts.preview?.total, policy, risk, cannotUndo } as object,
      },
    });
    const envelope = this.render.approval({
      serverId: opts.serverKey,
      toolName: opts.toolName,
      risk,
      approvalId: approval.id,
      preview: { ...opts.preview, policy, cannotUndo },
    });
    await this.prisma.integrationInvocation.update({ where: { id: inv.id }, data: { renderEnvelope: envelope as object } });
    await this.audit.record({
      action: "AGENT_REQUESTED_APPROVAL" as never,
      summary: `Preview for ${opts.toolName} (${risk}) — needs ${policy} approval`,
      payload: { invocationId: inv.id, risk, policy }, // NO input (may carry sensitive args)
      undo: { type: "NONE" },
    });
    return { status: "NEEDS_APPROVAL", envelope, invocationId: inv.id, approvalId: approval.id };
  }

  // Approve + execute a previously-previewed mutation. Enforces the role policy (§Transaction
  // Lifecycle): organizer-policy actions require an ORGANIZER; member/group accept any member.
  async approveAndExecute(approvalId: string, actor: { id: string; role: string }) {
    const approval = await this.prisma.externalActionApproval.findUniqueOrThrow({
      where: { id: approvalId },
      include: { invocation: true },
    });
    if (approval.state !== "PENDING") throw new BadRequestException(`approval already ${approval.state}`);
    if (approval.policy === "organizer" && actor.role !== "ORGANIZER") {
      throw new ForbiddenException("paid/irreversible actions require organizer approval");
    }
    await this.prisma.externalActionApproval.update({
      where: { id: approvalId },
      data: { state: "APPROVED", approvedBy: actor.id, approvedAt: new Date() },
    });
    const inv = approval.invocation;
    const input = (inv.sanitizedInput as Record<string, unknown>) ?? {};
    return this.execute(inv.id, inv.serverKey ?? "", inv.toolName, input, { risk: inv.risk as McpRisk, approvalId });
  }

  private async execute(
    invocationId: string,
    serverKey: string,
    toolName: string,
    input: Record<string, unknown>,
    meta: { rendererHint?: Renderer; capability?: string; attribution?: { label: string; url?: string }[]; risk?: McpRisk; approvalId?: string },
  ) {
    if (!this.executor) {
      const envelope = this.render.error(serverKey, toolName, "connector not executable in this environment");
      await this.prisma.integrationInvocation.update({ where: { id: invocationId }, data: { status: "DEGRADED", renderEnvelope: envelope as object, finishedAt: new Date() } });
      return { status: "DEGRADED", envelope, invocationId, approvalId: meta.approvalId };
    }
    try {
      const output = await this.executor.call(serverKey, toolName, input);
      const envelope = this.render.result({ serverId: serverKey, toolName, output, rendererHint: meta.rendererHint, capability: meta.capability, attribution: meta.attribution, risk: meta.risk });
      await this.prisma.integrationInvocation.update({
        where: { id: invocationId },
        data: { status: "READY", sanitizedOutput: this.sanitize(output) as object, renderEnvelope: envelope as object, finishedAt: new Date() },
      });
      if (meta.approvalId) {
        await this.prisma.externalActionApproval.update({ where: { id: meta.approvalId }, data: { state: "EXECUTED" } });
        await this.prisma.externalActionReceipt.create({ data: { invocationId, providerConfirmation: this.confirmationOf(output), cancellable: false } });
      }
      return { status: "READY", envelope, invocationId, approvalId: meta.approvalId };
    } catch (e) {
      const envelope = this.render.error(serverKey, toolName, (e as Error).message);
      await this.prisma.integrationInvocation.update({ where: { id: invocationId }, data: { status: "FAILED", renderEnvelope: envelope as object, finishedAt: new Date() } });
      if (meta.approvalId) await this.prisma.externalActionApproval.update({ where: { id: meta.approvalId }, data: { state: "FAILED" } });
      return { status: "FAILED", envelope, invocationId, approvalId: meta.approvalId };
    }
  }

  private confirmationOf(output: unknown): string | undefined {
    if (output && typeof output === "object") {
      const o = output as Record<string, unknown>;
      const c = o.confirmation ?? o.confirmationNumber ?? o.id;
      if (c != null) return String(c);
    }
    return undefined;
  }
}
