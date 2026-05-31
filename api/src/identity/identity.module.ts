import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { IdentityService } from "./identity.service";
import { AUTH_PROVIDER } from "./auth.provider";
import { OtpAuthProvider } from "./auth.otp";
import { MockAuthProvider } from "./auth.mock";
import { StytchAuthProvider } from "./auth.stytch";
import { RedisService } from "../common/redis.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotificationsService } from "../notifications/notifications.service";
import { config } from "../common/config";

// AUTH_PROVIDER: "otp" (default) = REAL phone-OTP (random code, Redis TTL, single-use, delivered via
// comms); "stytch" = hosted auth (//TODO key); "mock" = legacy fixed-code stand-in.
@Module({
  imports: [NotificationsModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    {
      provide: AUTH_PROVIDER,
      useFactory: (redis: RedisService, notify: NotificationsService) =>
        config.authProvider === "stytch"
          ? new StytchAuthProvider(redis)
          : config.authProvider === "mock"
            ? new MockAuthProvider()
            : new OtpAuthProvider(redis, notify),
      inject: [RedisService, NotificationsService],
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
