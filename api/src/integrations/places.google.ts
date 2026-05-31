import { Injectable } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { PlaceResult, PlacesProvider } from "./integrations.types";

// Real Google Places connector. Same interface as the mock.
// TODO: REAL CREDENTIAL — Places Text Search; map results (incl. phone/url for booking fallback).
@Injectable()
export class GooglePlacesProvider implements PlacesProvider {
  readonly requiredScope = PermissionScope.PLACES_SEARCH;
  async search(_query: string, _near?: string): Promise<PlaceResult[]> {
    throw new Error("GooglePlacesProvider not configured — use PLACES_PROVIDER=mock");
  }
}
