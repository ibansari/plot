import { Injectable, Logger } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { PlaceResult, PlacesProvider } from "./integrations.types";
import { DbPlacesProvider } from "./places.db";

// REAL live places fetch over OpenStreetMap's Nominatim API — a real external geospatial service
// with NO API key. Maps OSM results (name, address, lat/lng, phone/website from extratags) to
// PlaceResult. Per the connector contract it DEGRADES GRACEFULLY to the local DB catalog if the
// network/OSM is unavailable, so the slice never breaks. (Google Places would slot in here too.)
@Injectable()
export class OsmPlacesProvider implements PlacesProvider {
  readonly requiredScope = PermissionScope.PLACES_SEARCH;
  private readonly log = new Logger("OsmPlaces");
  constructor(private readonly fallback: DbPlacesProvider) {}

  async search(query: string, near?: string): Promise<PlaceResult[]> {
    const q = near ? `${query} ${near}` : query;
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q, format: "jsonv2", limit: "6", addressdetails: "1", extratags: "1" }).toString();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Plot/0.1 (dev; group planning agent)" }, // Nominatim usage policy
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      const rows = (await res.json()) as Array<{
        name?: string;
        display_name?: string;
        type?: string;
        category?: string;
        lat?: string;
        lon?: string;
        extratags?: { phone?: string; website?: string; "contact:phone"?: string };
      }>;
      const mapped: PlaceResult[] = rows
        .filter((r) => r.name || r.display_name)
        .slice(0, 3)
        .map((r) => ({
          name: r.name || (r.display_name ?? "").split(",")[0],
          address: r.display_name ?? "",
          priceTier: 2, // OSM has no price; default mid-tier
          phone: r.extratags?.phone ?? r.extratags?.["contact:phone"],
          url: r.extratags?.website,
          tags: [r.category, r.type].filter(Boolean) as string[],
        }));
      if (!mapped.length) throw new Error("no OSM results");
      this.log.log(`Nominatim "${q}" → ${mapped.map((m) => m.name).join(", ")}`);
      return mapped;
    } catch (e) {
      this.log.warn(`OSM unavailable (${(e as Error).message}) — degrading to local catalog`);
      return this.fallback.search(query, near);
    }
  }
}
