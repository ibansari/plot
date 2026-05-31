import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import Redis from "ioredis";
import { config } from "./config";

// Cache / short-lived KV (used by the cache layer AND the real OTP store). Uses Redis when it's
// reachable; otherwise transparently falls back to an in-process TTL map so dev features (OTP issue
// /verify, rate-limit) keep working even if Redis is momentarily down. Same semantics either way.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger("Redis");
  private client: Redis | null = null;
  private readonly mem = new Map<string, { value: string; expires: number }>();

  private get redis(): Redis | null {
    if (this.client) return this.client;
    try {
      this.client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (n) => (n > 5 ? null : 500), // light reconnect attempts, then give up to mem
      });
      this.client.on("error", () => {
        /* swallow; we transparently fall back to the in-process map */
      });
    } catch (e) {
      this.log.warn(`Redis unavailable, using in-process store: ${e}`);
    }
    return this.client;
  }

  private connected(): boolean {
    return !!this.client && this.client.status === "ready";
  }

  // ── in-process fallback ──
  private memGet(key: string): string | null {
    const e = this.mem.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) { this.mem.delete(key); return null; }
    return e.value;
  }
  private memSet(key: string, value: string, ttl: number) {
    this.mem.set(key, { value, expires: Date.now() + ttl * 1000 });
  }

  async get(key: string): Promise<string | null> {
    if (this.connected()) {
      try { return (await this.redis!.get(key)) ?? null; } catch { /* fall through */ }
    } else {
      void this.redis; // kick off a (re)connect attempt
    }
    return this.memGet(key);
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    this.memSet(key, value, ttlSeconds); // always mirror to mem so a mid-flight Redis drop is safe
    if (this.connected()) {
      try { await this.redis!.set(key, value, "EX", ttlSeconds); } catch { /* mem already has it */ }
    } else {
      void this.redis;
    }
  }

  async del(key: string): Promise<void> {
    this.mem.delete(key);
    if (this.connected()) { try { await this.redis!.del(key); } catch { /* ignore */ } }
  }

  async incr(key: string, ttlSeconds = 300): Promise<number> {
    if (this.connected()) {
      try {
        const n = await this.redis!.incr(key);
        if (n === 1) await this.redis!.expire(key, ttlSeconds);
        return n;
      } catch { /* fall through to mem */ }
    } else {
      void this.redis;
    }
    const n = parseInt(this.memGet(key) ?? "0", 10) + 1;
    this.memSet(key, String(n), ttlSeconds);
    return n;
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
