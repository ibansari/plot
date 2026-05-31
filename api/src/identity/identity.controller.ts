import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { IdentityService } from "./identity.service";
import { AuthGuard, AuthedRequest } from "../common/auth.guard";
import { PermissionScope } from "@plot/db";

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post("auth/otp/start")
  startOtp(@Body() body: { phone: string }) {
    return this.identity.startOtp(body.phone);
  }

  @Post("auth/otp/verify")
  verifyOtp(@Body() body: { phone: string; code: string }) {
    return this.identity.verifyOtp(body.phone, body.code);
  }

  @Post("auth/apple")
  apple(@Body() body: { identityToken: string; displayName?: string }) {
    return this.identity.verifyApple(body.identityToken, body.displayName);
  }

  @UseGuards(AuthGuard)
  @Get("me")
  me(@Req() req: AuthedRequest) {
    return this.identity.me(req.userId!);
  }

  @UseGuards(AuthGuard)
  @Post("me/availability")
  syncAvailability(@Req() req: AuthedRequest, @Body() b: { intervals: { startsAt: string; endsAt: string }[] }) {
    return this.identity.syncAvailability(req.userId!, b.intervals ?? []);
  }

  @UseGuards(AuthGuard)
  @Post("me/devices")
  registerDevice(@Req() req: AuthedRequest, @Body() b: { apnsToken: string; platform?: string }) {
    return this.identity.registerDevice(req.userId!, b.apnsToken, b.platform);
  }

  @UseGuards(AuthGuard)
  @Get("me/permissions")
  getPermissions(@Req() req: AuthedRequest, @Query("groupId") groupId?: string) {
    return this.identity.getPermissions(req.userId!, groupId);
  }

  @UseGuards(AuthGuard)
  @Put("me/permissions")
  setPermission(@Req() req: AuthedRequest, @Body() b: { scope: PermissionScope; granted: boolean; groupId?: string }) {
    return this.identity.setPermission(req.userId!, b.scope, b.granted, b.groupId);
  }

  @UseGuards(AuthGuard)
  @Put("me/spend-cap")
  setSpendCap(@Req() req: AuthedRequest, @Body() b: { cents: number }) {
    return this.identity.setSpendCap(req.userId!, b.cents);
  }
}
