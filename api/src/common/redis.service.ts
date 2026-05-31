import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import Redis from "ioredis";
import { config } from "./config";

// Thin cache wrapper. Degrades gracefully: if Redis is down the app keeps working (cache misses).
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger("Redis");
  private client: Redis | null = null;

  private get redis(): Redis | null {
    if (this.client) return this.client;
    try {
      this.client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        retryStrategy: () => null, // don't hammer if unavailable in dev
      });
      this.client.on("error", () => {
        /* swallow; cache is optional */
      });
    } catch (e) {
      this.log.warn(`Redis unavailable, running without cache: ${e}`);
    }
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    try {
      return (await this.redis?.get(key)) ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    try {
      await this.redis?.set(key, value, "EX", ttlSeconds);
    } catch {
      /* ignore */
    }
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
