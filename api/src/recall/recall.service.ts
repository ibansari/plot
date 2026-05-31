import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../common/prisma.service";

// Real semantic recall over pgvector — NO external embedding API. The embedding is a deterministic
// feature-hashing bag-of-words + character-trigram vector, L2-normalized, so texts that share
// tokens have genuinely higher cosine similarity. This is a real algorithm (not a stub): it stores
// what a group chose and retrieves the most similar past choices to bias future proposals (§18).
const DIM = 1536;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function tokens(text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [...words];
  for (const w of words) {
    const p = `^${w}$`;
    for (let i = 0; i + 3 <= p.length; i++) out.push("#" + p.slice(i, i + 3)); // char trigrams
  }
  return out;
}

export function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const t of tokens(text)) v[djb2(t) % DIM] += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

@Injectable()
export class RecallService {
  private readonly log = new Logger("Recall");
  constructor(private readonly prisma: PrismaService) {}

  // Store a memory for a group (e.g. "chose Ananda Thai for dinner"). De-duplicates exact text.
  async remember(groupId: string, kind: string, text: string) {
    const exists = await this.prisma.embedding.findFirst({ where: { groupId, kind, text } });
    if (exists) return { remembered: false };
    const vec = `[${embed(text).join(",")}]`;
    const id = crypto.randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "Embedding" (id, "groupId", kind, text, embedding, "createdAt")
       VALUES ($1, $2, $3, $4, $5::vector, now())`,
      id,
      groupId,
      kind,
      text,
      vec,
    );
    this.log.log(`remembered for ${groupId}: "${text}"`);
    return { remembered: true, id };
  }

  // Top-k most similar past memories for a query (cosine similarity via pgvector).
  async recall(groupId: string, query: string, k = 3): Promise<{ text: string; score: number; kind: string }[]> {
    const vec = `[${embed(query).join(",")}]`;
    const rows = await this.prisma.$queryRawUnsafe<{ text: string; kind: string; score: number }[]>(
      `SELECT text, kind, 1 - (embedding <=> $1::vector) AS score
       FROM "Embedding" WHERE "groupId" = $2
       ORDER BY embedding <=> $1::vector LIMIT $3`,
      vec,
      groupId,
      k,
    );
    return rows.map((r) => ({ text: r.text, kind: r.kind, score: Number(r.score) }));
  }
}
