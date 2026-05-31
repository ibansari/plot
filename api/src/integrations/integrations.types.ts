// Typed connector contracts. Every connector: declares required scope, is permission-checked at
// the call site, and degrades gracefully (returns empty/usable data rather than throwing).

import { PermissionScope } from "@plot/db";

// NOTE: by design there is NO title/details field here — calendars store busy/free ONLY (§13).
export interface BusyInterval {
  startsAt: string; // ISO
  endsAt: string; // ISO
}

export interface CalendarProvider {
  readonly requiredScope: PermissionScope;
  /** Busy intervals for a user in a window. Free = the complement. */
  getBusy(userId: string, fromIso: string, toIso: string): Promise<BusyInterval[]>;
}

export interface PlaceResult {
  name: string;
  address: string;
  priceTier: number; // 1..4
  phone?: string; // enables graceful tap-to-call booking degradation
  url?: string; // enables deep-link degradation
  tags?: string[];
}

export interface PlacesProvider {
  readonly requiredScope: PermissionScope;
  search(query: string, near?: string): Promise<PlaceResult[]>;
}

export const CALENDAR_PROVIDER = Symbol("CALENDAR_PROVIDER");
export const PLACES_PROVIDER = Symbol("PLACES_PROVIDER");
