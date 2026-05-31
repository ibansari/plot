import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { NonUserGatewayService } from "./non-user.service";
import { AuthGuard } from "../common/auth.guard";
import { RsvpStatus, VoteValue } from "@plot/db";

@Controller()
export class NonUserGatewayController {
  constructor(private readonly gateway: NonUserGatewayService) {}

  // ── public (the non-user's browser; NO auth — the signed token IS the auth) ──
  @Get("public/tokens/:id")
  page(@Param("id") id: string, @Query("s") s: string) {
    return this.gateway.pageData(id, s);
  }

  @Post("public/tokens/:id/vote")
  vote(@Param("id") id: string, @Body() b: { s: string; optionId: string; value?: VoteValue }) {
    return this.gateway.vote(id, b.s, b.optionId, b.value ?? VoteValue.UP);
  }

  @Post("public/tokens/:id/rsvp")
  rsvp(@Param("id") id: string, @Body() b: { s: string; status: RsvpStatus }) {
    return this.gateway.rsvp(id, b.s, b.status);
  }

  // ── internal (agent's send-nonuser-invite tool) ──
  @UseGuards(AuthGuard)
  @Post("internal/non-user-invites")
  invite(@Body() b: { planId: string; contactId: string; purpose?: "vote" | "rsvp" | "pay" }) {
    return this.gateway.invite(b.planId, b.contactId, b.purpose ?? "vote");
  }
}
