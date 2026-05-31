import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { MapsService } from "./maps.service";
import { PrismaService } from "../../common/prisma.service";
import { encryptJson } from "../../common/crypto.util";
import { AuthGuard, AuthedRequest } from "../../common/auth.guard";
import { LatLng, TravelMode } from "./maps.types";

@UseGuards(AuthGuard)
@Controller()
export class MapsController {
  constructor(
    private readonly maps: MapsService,
    private readonly prisma: PrismaService,
  ) {}

  // ── agent: venue feasibility (search + private-origin route matrix + fairness). Group-visible. ──
  @Post("internal/maps/feasibility")
  feasibility(
    @Body() b: { groupId: string; query: string; planId?: string; near?: string; location?: LatLng; radiusMeters?: number },
  ) {
    return this.maps.feasibility(b);
  }

  // ── weather for an area/time (outdoor-plan fallback, §C4) ──
  @Post("internal/weather")
  weather(@Body() b: { near: string; when?: string }) {
    return this.maps.weatherForArea(b.near, b.when);
  }

  // ── member saves a private starting area + travel guardrails (coords encrypted at rest) ──
  @Post("me/travel-preference")
  async saveTravelPreference(
    @Req() req: AuthedRequest,
    @Body()
    b: {
      groupId: string;
      location: LatLng;
      savedPlaceId?: string;
      label?: string;
      mode?: TravelMode;
      softLimitMin?: number;
      hardLimit?: boolean;
      transitPrefs?: object;
    },
  ) {
    const userId = req.userId!;
    const originEnc = encryptJson(b.location); // PRIVATE — never returned to the group
    const data = {
      savedPlaceId: b.savedPlaceId,
      originEnc,
      label: b.label,
      mode: b.mode ?? "AUTO",
      softLimitMin: b.softLimitMin,
      hardLimit: b.hardLimit ?? false,
      transitPrefs: b.transitPrefs ?? undefined,
    };
    await this.prisma.memberTravelPreference.upsert({
      where: { groupId_userId: { groupId: b.groupId, userId } },
      update: data,
      create: { groupId: b.groupId, userId, ...data },
    });
    // echo back ONLY non-private fields
    return { saved: true, label: b.label, mode: data.mode, softLimitMin: b.softLimitMin, hardLimit: data.hardLimit };
  }

  // ── one-off current-location override for a single plan; expires with the plan (§Privacy) ──
  @Post("plans/:id/travel-override")
  async setOverride(@Param("id") planId: string, @Req() req: AuthedRequest, @Body() b: { location: LatLng; expiresAt?: string }) {
    const userId = req.userId!;
    const originEnc = encryptJson(b.location);
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : new Date(Date.now() + 12 * 3600_000);
    await this.prisma.planTravelOverride.upsert({
      where: { planId_userId: { planId, userId } },
      update: { originEnc, expiresAt },
      create: { planId, userId, originEnc, expiresAt },
    });
    return { override: true, expiresAt: expiresAt.toISOString() };
  }
}
