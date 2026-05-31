import { Logger } from "@nestjs/common";
import * as stytch from "stytch";
import { AuthProvider, OtpStartResult, VerifiedIdentity } from "./auth.provider";
import { RedisService } from "../common/redis.service";
import { config } from "../common/config";

// REAL Stytch-backed phone-OTP. Makes genuine Stytch API calls (test or live env auto-detected from
// the project id). startOtp → otps.sms.loginOrCreate (Stytch sends the SMS + returns a method id we
// stash in Redis); verifyOtp → otps.authenticate. No fixed dev code — Stytch owns code generation.
export class StytchAuthProvider implements AuthProvider {
  private readonly log = new Logger("Stytch");
  private readonly client: stytch.Client;

  constructor(private readonly redis: RedisService) {
    if (!config.stytchProjectId || !config.stytchSecret) {
      throw new Error("Stytch not configured — set STYTCH_PROJECT_ID and STYTCH_SECRET");
    }
    this.client = new stytch.Client({ project_id: config.stytchProjectId, secret: config.stytchSecret });
    this.log.log(`Stytch client ready (${config.stytchProjectId.split("-").slice(0, 2).join("-")}…)`);
  }

  async startOtp(phone: string): Promise<OtpStartResult> {
    const res = await this.client.otps.sms.loginOrCreate({ phone_number: phone });
    // stash the method id Stytch needs to authenticate this attempt (TTL > the code's lifetime)
    await this.redis.set(`stytch_method:${phone}`, res.phone_id, 600);
    this.log.log(`Stytch SMS OTP queued for ${phone} (method ${res.phone_id})`);
    return { sent: true }; // real code delivered by Stytch — never returned to the client
  }

  async verifyOtp(phone: string, code: string): Promise<VerifiedIdentity> {
    const methodId = await this.redis.get(`stytch_method:${phone}`);
    if (!methodId) throw new Error("no OTP in progress — request a new code");
    const res = await this.client.otps.authenticate({ method_id: methodId, code });
    await this.redis.del(`stytch_method:${phone}`);
    const verified = res.user?.phone_numbers?.[0]?.phone_number ?? phone;
    return { phone: verified };
  }

  async verifyApple(identityToken: string, displayName?: string): Promise<VerifiedIdentity> {
    // Stytch "Sign in with Apple" is an OAuth redirect flow that yields a Stytch token, which is
    // then exchanged here. (The raw iOS Apple identityToken would instead be JWT-verified vs Apple's
    // JWKS.) //TODO: wire the OAuth redirect on the client to obtain `token`.
    const res = await this.client.oauth.authenticate({ token: identityToken });
    return { appleSub: (res as { provider_subject?: string }).provider_subject ?? res.user_id, displayName };
  }
}
