import { scoreCandidates, summarizeTravel, fairnessScore } from "../src/integrations/maps/fairness";
import { CandidateVenue, MemberOrigin, RouteCell } from "../src/integrations/maps/maps.types";

// Slice 1 fairness: hard limits remove venues, soft limits annotate, the output is group-visible
// (named ETAs only, NO coordinates), and ranking spreads the burden.
describe("travel fairness (§Candidate Research)", () => {
  const origins: MemberOrigin[] = [
    { memberId: "m1", name: "Alex", origin: { lat: 40.71, lng: -73.99 }, mode: "DRIVE" },
    { memberId: "m2", name: "Sam", origin: { lat: 40.73, lng: -73.95 }, mode: "TRANSIT", softLimitMin: 30 },
    { memberId: "m3", name: "Jordan", origin: { lat: 40.68, lng: -73.94 }, mode: "DRIVE", softLimitMin: 25, hardLimit: true },
  ];

  function cells(perVenue: number[][]): RouteCell[] {
    // perVenue[di][oi] = minutes (or -1 = no route)
    const out: RouteCell[] = [];
    perVenue.forEach((row, di) =>
      row.forEach((min, oi) =>
        out.push({ originIndex: oi, destinationIndex: di, durationSeconds: min < 0 ? null : min * 60, distanceMeters: min < 0 ? null : min * 800, ok: min >= 0 }),
      ),
    );
    return out;
  }

  const venues: CandidateVenue[] = [
    { id: "v_close", name: "Close Spot" },
    { id: "v_far_for_jordan", name: "Far-for-Jordan" },
  ];

  it("summarizes named ETAs with NO coordinates and correct guardrails", () => {
    const s = summarizeTravel(origins, [10, 35, 20]); // Sam 35 > soft 30 (soft); Jordan 20 ok
    expect(s.namedEtas.map((n) => n.name)).toEqual(["Alex", "Sam", "Jordan"]);
    expect(JSON.stringify(s)).not.toMatch(/lat|lng|40\.7/); // no coordinate ever leaks
    expect(s.namedEtas[1].guardrail).toBe("SOFT");
    expect(s.softWarnings).toBe(1);
    expect(s.hardFailures).toBe(0);
    expect(s.medianEtaMin).toBe(20);
    expect(s.maxEtaMin).toBe(35);
    expect(s.spreadMin).toBe(25);
  });

  it("removes a venue that breaks a HARD limit, annotates soft, ranks fairest first", () => {
    const scored = scoreCandidates(
      origins,
      venues,
      // Close: all reasonable. Far: Jordan 40 > hard 25 → HARD fail
      cells([
        [12, 18, 15], // Close Spot
        [20, 22, 40], // Far-for-Jordan (Jordan 40 > 25 hard)
      ]),
    );
    const far = scored.find((s) => s.venue.id === "v_far_for_jordan")!;
    const close = scored.find((s) => s.venue.id === "v_close")!;
    expect(far.removed).toBe(true);
    expect(far.travel.hardFailures).toBe(1);
    expect(close.removed).toBe(false);
    expect(scored[0].venue.id).toBe("v_close"); // kept + fairer ranks first
  });

  it("marks unknown ETAs when the route matrix is partial", () => {
    const s = summarizeTravel(origins, [10, null, 20]);
    expect(s.unknown).toBe(1);
    expect(s.namedEtas[1].guardrail).toBe("UNKNOWN");
    expect(s.namedEtas[1].durationMin).toBeNull();
  });

  it("fairness score punishes hard failures heavily and rewards low spread", () => {
    const tight = summarizeTravel(origins, [15, 16, 17]);
    const uneven = summarizeTravel(origins, [5, 5, 45]);
    expect(fairnessScore(tight)).toBeLessThan(fairnessScore(uneven));
  });
});
