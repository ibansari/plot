import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { IdentityService } from "./identity.service";
import { AUTH_PROVIDER } from "./auth.provider";
import { MockAuthProvider } from "./auth.mock";
import { StytchAuthProvider } from "./auth.stytch";
import { config } from "../common/config";

// Provider selection happens here: AUTH_PROVIDER=mock (default) | stytch.
@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    {
      provide: AUTH_PROVIDER,
      useFactory: () =>
        config.authProvider === "stytch" ? new StytchAuthProvider() : new MockAuthProvider(),
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
