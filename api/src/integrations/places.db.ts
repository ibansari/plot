import { Injectable } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { PrismaService } from "../common/prisma.service";
import { PlaceResult, PlacesProvider } from "./integrations.types";

// Real Places search over the seeded `Place` catalog in Postgres — a genuine data-store query
// (tag/name relevance), not hardcoded in-code results. Real Google/Foursquare would upsert into the
// same table behind this seam (//TODO: REAL CREDENTIAL for live fetch). Needs no external key.
@Injectable()
export class DbPlacesProvider implements PlacesProvider {
  readonly requiredScope = PermissionScope.PLACES_SEARCH;
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, _near?: string): Promise<PlaceResult[]> {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    // candidate set: anything whose tags/name match a query term (fall back to all if no match)
    const candidates = await this.prisma.place.findMany({
      where: terms.length
        ? { OR: [{ tags: { hasSome: terms } }, ...terms.map((t) => ({ name: { contains: t, mode: "insensitive" as const } }))] }
        : undefined,
      take: 50,
    });
    const pool = candidates.length ? candidates : await this.prisma.place.findMany({ take: 50 });

    // relevance = tag overlap + name match, then cheaper first (helps stay under the cap)
    const scored = pool
      .map((p) => {
        const tagOverlap = p.tags.filter((t) => terms.includes(t)).length;
        const nameHit = terms.some((t) => p.name.toLowerCase().includes(t)) ? 1 : 0;
        return { p, score: tagOverlap * 2 + nameHit };
      })
      .sort((a, b) => b.score - a.score || a.p.priceTier - b.p.priceTier);

    return scored.slice(0, 3).map(({ p }) => ({
      name: p.name,
      address: p.address,
      priceTier: p.priceTier,
      phone: p.phone ?? undefined,
      url: p.url ?? undefined,
      tags: p.tags,
    }));
  }
}
