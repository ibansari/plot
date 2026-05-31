import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { decryptJson } from "../../common/crypto.util";
import { config } from "../../common/config";
import { scoreCandidates } from "./fairness";
import {
  CandidateVenue,
  LatLng,
  MemberOrigin,
  NATIVE_PLACES_PROVIDER,
  PlacesProviderNative,
  ROUTES_PROVIDER,
  RoutesProvider,
  ScoredCandidate,
  TravelMode,
} from "./maps.types";

export interface FeasibilityResult {
  status: "READY" | "DEGRADED";
  reason?: string;
  candidates: ScoredCandidate[]; // group-visible (no origins)
  attribution: { label: string; url?: string }[];
}

// Native Maps orchestration (Slice 1). Loads PRIVATE member origins (decrypted server-side),
// searches venues, computes a route matrix, scores fairness, and returns ONLY group-visible scored
// candidates (named ETAs, no coordinates). Degrades to a DEGRADED status (never throws) when the
// Google key is missing or origins aren't on record.
@Injectable()
export class MapsService {
  private readonly log = new Logger("Maps");
  private readonly attribution = [{ label: "Powered by Google", url: "https://developers.google.com/maps" }];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NATIVE_PLACES_PROVIDER) private readonly places: PlacesProviderNative,
    @Inject(ROUTES_PROVIDER) private readonly routes: RoutesProvider,
  ) {}

  searchVenues(query: string, area?: { near?: string; location?: LatLng; radiusMeters?: number }) {
    return this.places.search(query, area);
  }

  // Load every member's PRIVATE origin for a group (applying an active per-plan override), decrypt
  // coordinates server-side. Result never leaves this service except as derived ETAs.
  async loadOrigins(groupId: string, planId?: string): Promise<MemberOrigin[]> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true, contact: true },
    });
    const prefs = await this.prisma.memberTravelPreference.findMany({ where: { groupId } });
    const overrides = planId
      ? await this.prisma.planTravelOverride.findMany({ where: { planId, expiresAt: { gt: new Date() } } })
      : [];

    const out: MemberOrigin[] = [];
    for (const m of members) {
      const pref = prefs.find((p) => (m.userId && p.userId === m.userId) || (m.contactId && p.contactId === m.contactId));
      const ovr = overrides.find((o) => (m.userId && o.userId === m.userId) || (m.contactId && o.contactId === m.contactId));
      const enc = ovr?.originEnc ?? pref?.originEnc;
      if (!enc) continue; // no saved origin → member simply isn't in the ETA matrix
      let origin: LatLng;
      try {
        origin = decryptJson<LatLng>(enc);
      } catch {
        continue;
      }
      out.push({
        memberId: m.id,
        name: m.user?.displayName ?? m.contact?.displayName ?? "?",
        origin,
        mode: ((pref?.mode as TravelMode) ?? "AUTO"),
        softLimitMin: pref?.softLimitMin ?? undefined,
        hardLimit: pref?.hardLimit ?? false,
      });
    }
    return out;
  }

  // Core: rank venues by travel fairness for a set of (already-loaded, private) origins.
  async scoreVenues(origins: MemberOrigin[], venues: CandidateVenue[]): Promise<ScoredCandidate[]> {
    if (origins.length === 0 || venues.length === 0) return venues.map((v) => emptyScore(v));
    const matrix = await this.routes.computeRouteMatrix(
      origins.map((o) => ({ location: o.origin, mode: o.mode })),
      venues.map((v) => (v.id && v.location ? { placeId: v.id, location: v.location } : { location: v.location })),
    );
    // origins stay private — log only a routing summary count, never coordinates (§Privacy)
    this.log.log(`routed ${origins.length} origin(s) × ${venues.length} venue(s) → ${matrix.length} cells`);
    return scoreCandidates(origins, venues, matrix);
  }

  // End-to-end feasibility the agent calls: search → load private origins → route → score.
  async feasibility(input: {
    groupId: string;
    query: string;
    planId?: string;
    near?: string;
    location?: LatLng;
    radiusMeters?: number;
  }): Promise<FeasibilityResult> {
    if (!config.googleMapsApiKey) {
      return { status: "DEGRADED", reason: "maps not configured", candidates: [], attribution: this.attribution };
    }
    const venues = await this.searchVenues(input.query, { near: input.near, location: input.location, radiusMeters: input.radiusMeters });
    if (venues.length === 0) {
      return { status: "DEGRADED", reason: "no venues found", candidates: [], attribution: this.attribution };
    }
    const origins = await this.loadOrigins(input.groupId, input.planId);
    const candidates = await this.scoreVenues(origins, venues);
    return {
      status: origins.length ? "READY" : "DEGRADED",
      reason: origins.length ? undefined : "no member origins on record — ETAs unavailable",
      candidates,
      attribution: this.attribution,
    };
  }
}

function emptyScore(v: CandidateVenue): ScoredCandidate {
  return {
    venue: v,
    travel: { medianEtaMin: null, maxEtaMin: null, spreadMin: null, fairnessScore: 0, softWarnings: 0, hardFailures: 0, unknown: 0, namedEtas: [] },
    removed: false,
  };
}
