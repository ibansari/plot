// Native Maps types (Slice 1). The privacy invariant lives in the type split:
// `MemberOrigin` carries PRIVATE coordinates and is server-only; everything that can reach a group
// plan DTO (`NamedEta`, `TravelSummary`) exposes only name / mode / duration / guardrail — never an
// origin coordinate or address.

export type LatLng = { lat: number; lng: number };

export type TravelMode = "DRIVE" | "TRANSIT" | "WALK" | "BICYCLE" | "AUTO";

export type Guardrail = "OK" | "SOFT" | "HARD" | "UNKNOWN";

// PRIVATE — must never be serialized into a group-visible payload, audit, or render envelope.
export interface MemberOrigin {
  memberId: string;
  name: string; // group-visible display name
  origin: LatLng; // PRIVATE coordinate
  mode: TravelMode;
  softLimitMin?: number; // soft max ETA (annotate, don't remove)
  hardLimit?: boolean; // if true, a violating venue is removed before the draft card
}

export interface CandidateVenue {
  id: string; // Google place id (preferred for route waypoints) or internal id
  name: string;
  address?: string;
  location?: LatLng;
  priceTier?: number; // 1..4
  tags?: string[];
}

// group-visible per-member ETA — NO origin coordinate, NO address.
export interface NamedEta {
  name: string;
  mode: TravelMode;
  durationMin: number | null; // null = unknown (partial route matrix)
  distanceMeters?: number | null;
  guardrail: Guardrail;
}

export interface TravelSummary {
  medianEtaMin: number | null;
  maxEtaMin: number | null;
  spreadMin: number | null; // max - min
  fairnessScore: number; // lower is fairer/better (used for ranking)
  softWarnings: number;
  hardFailures: number;
  unknown: number; // members with no computable ETA
  namedEtas: NamedEta[]; // group-visible
}

export interface ScoredCandidate {
  venue: CandidateVenue;
  travel: TravelSummary;
  removed: boolean; // removed due to a hard-limit violation
  removalReason?: string;
}

// one cell of a Routes computeRouteMatrix response (origin x destination)
export interface RouteCell {
  originIndex: number;
  destinationIndex: number;
  durationSeconds: number | null; // null when route not found
  distanceMeters: number | null;
  ok: boolean;
}

export interface PlacesProviderNative {
  search(query: string, area?: { near?: string; location?: LatLng; radiusMeters?: number }): Promise<CandidateVenue[]>;
}

export interface RoutesProvider {
  // origins x destinations duration/distance matrix; per-origin travel mode supported
  computeRouteMatrix(
    origins: { location: LatLng; mode: TravelMode }[],
    destinations: { location?: LatLng; placeId?: string }[],
  ): Promise<RouteCell[]>;
}

export const NATIVE_PLACES_PROVIDER = Symbol("NATIVE_PLACES_PROVIDER");
export const ROUTES_PROVIDER = Symbol("ROUTES_PROVIDER");
