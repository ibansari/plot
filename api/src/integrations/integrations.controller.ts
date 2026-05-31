import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { AuditService } from "../common/audit.service";
import { AuthGuard } from "../common/auth.guard";
import { AuditAction } from "@plot/db";

// Internal endpoints the agent's gather-availability / research nodes call. Each writes an audit row.
@UseGuards(AuthGuard)
@Controller("internal/integrations")
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
  ) {}

  @Post("availability")
  async availability(@Body() b: { groupId: string; fromIso: string; toIso: string; planId?: string }) {
    const summary = await this.integrations.gatherAvailability(b.groupId, b.fromIso, b.toIso);
    await this.audit.record({
      planId: b.planId,
      action: AuditAction.AGENT_GATHERED_AVAILABILITY,
      summary: `Gathered busy/free for ${summary.perMember.length} members`,
      payload: { window: [b.fromIso, b.toIso], topSlot: summary.suggestions[0] },
      undo: { type: "NONE" },
    });
    return summary;
  }

  @Post("places")
  async places(@Body() b: { userId: string; groupId: string; query: string; near?: string; planId?: string }) {
    const results = await this.integrations.researchPlaces(b.userId, b.groupId, b.query, b.near);
    await this.audit.record({
      planId: b.planId,
      action: AuditAction.AGENT_RESEARCHED_PLACES,
      summary: `Researched "${b.query}" → ${results.length} options`,
      payload: { results: results.map((r) => r.name) },
      undo: { type: "NONE" },
    });
    return results;
  }
}
