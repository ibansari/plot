import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { RecallService } from "./recall.service";
import { AuthGuard } from "../common/auth.guard";

// Internal recall surface: the agent (and inspection) can query a group's semantic memory and add
// to it. Memories are written automatically when a plan locks (see PlanService.lock).
@UseGuards(AuthGuard)
@Controller("internal/groups/:id/memory")
export class RecallController {
  constructor(private readonly recall: RecallService) {}

  @Get()
  query(@Param("id") groupId: string, @Query("q") q: string, @Query("k") k?: string) {
    return this.recall.recall(groupId, q ?? "", k ? parseInt(k, 10) : 3);
  }

  @Post()
  remember(@Param("id") groupId: string, @Body() b: { kind?: string; text: string }) {
    return this.recall.remember(groupId, b.kind ?? "note", b.text);
  }
}
