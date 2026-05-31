import { embed } from "../src/recall/recall.service";

// The recall embedding is a REAL deterministic feature-hashing vector (no external API): texts that
// share tokens must be more cosine-similar than unrelated ones, and identical text is identical.
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are L2-normalized, so dot == cosine similarity
}

describe("recall embedding (real semantic memory)", () => {
  it("produces a 1536-d L2-normalized vector", () => {
    const v = embed("dinner at ananda thai");
    expect(v.length).toBe(1536);
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    expect(embed("games night at max's")).toEqual(embed("games night at max's"));
  });

  it("ranks related text above unrelated text", () => {
    const q = embed("thai dinner downtown");
    const related = cosine(q, embed("chose ananda thai for dinner"));
    const unrelated = cosine(q, embed("bowling and arcade games night"));
    expect(related).toBeGreaterThan(unrelated);
    expect(related).toBeGreaterThan(0.1);
  });
});
