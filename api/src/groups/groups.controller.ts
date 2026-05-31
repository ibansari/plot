import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { GroupsService } from "./groups.service";
import { AuthGuard, AuthedRequest } from "../common/auth.guard";

@UseGuards(AuthGuard)
@Controller()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get("me/groups")
  myGroups(@Req() req: AuthedRequest) {
    return this.groups.myGroups(req.userId!);
  }

  @Post("groups")
  create(@Req() req: AuthedRequest, @Body() b: { name: string }) {
    return this.groups.createGroup(req.userId!, b.name);
  }

  @Get("groups/:id")
  get(@Param("id") id: string) {
    return this.groups.getGroup(id);
  }

  @Post("groups/:id/members")
  addMember(@Param("id") id: string, @Body() b: { phone: string; displayName?: string; asNonUser?: boolean }) {
    return this.groups.addMember(id, b);
  }

  // ── internal (agent's remember node): persist a constraint a member stated in chat (§A7) ──
  @Post("internal/groups/:id/constraints")
  remember(
    @Param("id") groupId: string,
    @Body() b: { userId?: string; contactId?: string; text: string; kind: string; expiresAt?: string },
  ) {
    return this.groups.rememberConstraint(groupId, b);
  }
}
