import { Injectable, Logger } from "@nestjs/common";
import { config } from "../../common/config";
import { CandidateVenue, LatLng, PlacesProviderNative } from "./maps.types";

// Native Google Places (new Places API web service) for server-side venue discovery. Uses an
// explicit field mask so we fetch only what the UI + booking fallback need (cost control, §Native
// Maps Boundary). Stores Google place IDs (preferred for route waypoints) + coordinates. Degrades
// to [] when no key — callers surface a DEGRADED status rather than crashing.
const PRICE: Record<string, number> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

@Injectable()
export class GooglePlacesProvider implements PlacesProviderNative {
  private readonly log = new Logger("GooglePlaces");

  async search(
    query: string,
    area?: { near?: string; location?: LatLng; radiusMeters?: number },
  ): Promise<CandidateVenue[]> {
    if (!config.googleMapsApiKey) {
      this.log.warn("no GOOGLE_MAPS_API_KEY — places search degraded to []");
      return [];
    }
    const body: Record<string, unknown> = {
      textQuery: area?.near ? `${query} near ${area.near}` : query,
      maxResultCount: 8,
    };
    if (area?.location) {
      body.locationBias = {
        circle: { center: { latitude: area.location.lat, longitude: area.location.lng }, radius: area.radiusMeters ?? 8000 },
      };
    }
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": config.googleMapsApiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.priceLevel,places.types,places.internationalPhoneNumber,places.websiteUri",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.log.warn(`Places searchText ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return [];
      }
      const data = (await res.json()) as { places?: any[] };
      return (data.places ?? []).map((p) => ({
        id: p.id,
        name: p.displayName?.text ?? "Unknown",
        address: p.formattedAddress,
        location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
        priceTier: p.priceLevel ? PRICE[p.priceLevel] : undefined,
        tags: p.types,
      }));
    } catch (e) {
      this.log.warn(`Places search failed: ${(e as Error).message}`);
      return [];
    }
  }
}
