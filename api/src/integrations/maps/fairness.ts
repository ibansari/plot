// Travel fairness scoring (Slice 1). Pure functions over private origins + a route matrix → a
// GROUP-VISIBLE TravelSummary. The output deliberately contains no coordinates: only named ETAs,
// guardrail status, and aggregate scores. Hard-limit violations are removed; soft are annotated;
// candidates are ranked so the same member isn't repeatedly the outlier (repeat-burden penalty).

import { CandidateVenue, Guardrail, MemberOrigin, NamedEta, RouteCell, ScoredCandidate, TravelSummary } from "./maps.types";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function guardrailFor(o: MemberOrigin, durationMin: number | null): Guardrail {
  if (durationMin == null) return "UNKNOWN";
  if (o.softLimitMin != null && durationMin > o.softLimitMin) return o.hardLimit ? "HARD" : "SOFT";
  return "OK";
}

/** Build the group-visible per-venue summary from each member's ETA (minutes). Origins stay private. */
export function summarizeTravel(
  origins: MemberOrigin[],
  durationMinByOrigin: (number | null)[],
  distanceByOrigin?: (number | null)[],
): TravelSummary {
  const namedEtas: NamedEta[] = origins.map((o, i) => ({
    name: o.name,
    mode: o.mode,
    durationMin: durationMinByOrigin[i] ?? null,
    distanceMeters: distanceByOrigin?.[i] ?? null,
    guardrail: guardrailFor(o, durationMinByOrigin[i] ?? null),
  }));
  const known = namedEtas.map((n) => n.durationMin).filter((d): d is number => d != null);
  const max = known.length ? Math.max(...known) : null;
  const min = known.length ? Math.min(...known) : null;
  return {
    medianEtaMin: known.length ? median(known) : null,
    maxEtaMin: max,
    spreadMin: max != null && min != null ? max - min : null,
    fairnessScore: 0, // filled by scoreCandidates (needs cross-venue context for repeat-burden)
    softWarnings: namedEtas.filter((n) => n.guardrail === "SOFT").length,
    hardFailures: namedEtas.filter((n) => n.guardrail === "HARD").length,
    unknown: namedEtas.filter((n) => n.durationMin == null).length,
    namedEtas,
  };
}

/** Lower is fairer/better. Balances how-far (median/max) against how-uneven (spread) and respects
 *  guardrails; `repeatBurden` nudges away from venues that punish an already-burdened member. */
export function fairnessScore(s: TravelSummary, repeatBurden = 0): number {
  const med = s.medianEtaMin ?? 999;
  const max = s.maxEtaMin ?? 999;
  const spread = s.spreadMin ?? 0;
  return (
    med * 1.0 +
    spread * 0.8 +
    max * 0.3 +
    s.softWarnings * 15 +
    s.hardFailures * 1000 +
    s.unknown * 30 +
    repeatBurden * 12
  );
}

/** Score + rank candidates. `matrix` cells index into `origins` (originIndex) and `venues`
 *  (destinationIndex). Removes hard-failure venues, annotates soft, ranks fairest-first. */
export function scoreCandidates(
  origins: MemberOrigin[],
  venues: CandidateVenue[],
  matrix: RouteCell[],
): ScoredCandidate[] {
  const cell = (oi: number, di: number) => matrix.find((c) => c.originIndex === oi && c.destinationIndex === di);

  // first pass: summary + the outlier (max-ETA member) per venue
  const pre = venues.map((venue, di) => {
    const durations = origins.map((_, oi) => {
      const c = cell(oi, di);
      return c && c.ok && c.durationSeconds != null ? Math.round(c.durationSeconds / 60) : null;
    });
    const distances = origins.map((_, oi) => cell(oi, di)?.distanceMeters ?? null);
    const summary = summarizeTravel(origins, durations, distances);
    let outlier = -1;
    let worst = -1;
    summary.namedEtas.forEach((n, i) => {
      if (n.durationMin != null && n.durationMin > worst) {
        worst = n.durationMin;
        outlier = i;
      }
    });
    return { venue, summary, outlier };
  });

  // repeat-burden: how many venues put the worst trip on the same member
  const outlierCounts = new Map<number, number>();
  for (const p of pre) if (p.outlier >= 0) outlierCounts.set(p.outlier, (outlierCounts.get(p.outlier) ?? 0) + 1);

  const scored: ScoredCandidate[] = pre.map((p) => {
    const repeatBurden = p.outlier >= 0 ? (outlierCounts.get(p.outlier) ?? 1) - 1 : 0;
    p.summary.fairnessScore = fairnessScore(p.summary, repeatBurden);
    const removed = p.summary.hardFailures > 0;
    return {
      venue: p.venue,
      travel: p.summary,
      removed,
      removalReason: removed ? `${p.summary.hardFailures} member(s) over a hard travel limit` : undefined,
    };
  });

  // kept venues ranked fairest-first; removed ones sink to the end (and the agent drops them)
  return scored.sort((a, b) => {
    if (a.removed !== b.removed) return a.removed ? 1 : -1;
    return a.travel.fairnessScore - b.travel.fairnessScore;
  });
}
