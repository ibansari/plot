import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";
import { RealtimeGateway } from "./realtime.gateway";
import { AuditService } from "./audit.service";
import { AuthGuard } from "./auth.guard";

// Global so every feature module can inject Prisma/Redis/Audit/Realtime without re-importing.
@Global()
@Module({
  providers: [PrismaService, RedisService, RealtimeGateway, AuditService, AuthGuard],
  exports: [PrismaService, RedisService, RealtimeGateway, AuditService, AuthGuard],
})
export class CommonModule {}
