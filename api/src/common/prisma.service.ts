import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@plot/db";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Prisma");

  // Resilient boot: don't crash the whole API if the DB is momentarily unreachable at startup —
  // Prisma reconnects lazily on the first query. (Without this a transient DB blip kills the process.)
  async onModuleInit() {
    try {
      await this.$connect();
    } catch (e) {
      this.log.warn(`DB not reachable at boot (${(e as Error).message}) — will connect on first query`);
    }
  }
  async onModuleDestroy() {
    await this.$disconnect().catch(() => undefined);
  }
}
