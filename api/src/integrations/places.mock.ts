import { Injectable } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { PlaceResult, PlacesProvider } from "./integrations.types";

// Canned, deterministic places so the research node has real, varied options to propose.
// Includes phone + url so booking can degrade gracefully to tap-to-call / deep link.
@Injectable()
export class MockPlacesProvider implements PlacesProvider {
  readonly requiredScope = PermissionScope.PLACES_SEARCH;

  async search(query: string, _near?: string): Promise<PlaceResult[]> {
    const q = query.toLowerCase();
    const all: PlaceResult[] = [
      { name: "Ananda Thai", address: "412 Mott St", priceTier: 2, phone: "+15551112222", url: "https://example.com/ananda", tags: ["thai", "dinner"] },
      { name: "The Back Room", address: "8 Norfolk St", priceTier: 3, phone: "+15553334444", url: "https://example.com/backroom", tags: ["bar", "cocktails"] },
      { name: "Pier 17 Rooftop", address: "89 South St", priceTier: 2, phone: "+15555556666", url: "https://example.com/pier17", tags: ["outdoor", "drinks", "view"] },
      { name: "Joe's Pizza", address: "7 Carmine St", priceTier: 1, phone: "+15557778888", url: "https://example.com/joes", tags: ["pizza", "casual"] },
      { name: "Lucia Trattoria", address: "120 Sullivan St", priceTier: 4, phone: "+15559990000", url: "https://example.com/lucia", tags: ["italian", "fancy", "dinner"] },
    ];
    // crude relevance: prefer tag/name matches, else return a sensible default set
    const scored = all
      .map((p) => ({ p, score: p.tags?.some((t) => q.includes(t)) || q.includes(p.name.toLowerCase()) ? 1 : 0 }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.p);
    return scored.slice(0, 3);
  }
}
