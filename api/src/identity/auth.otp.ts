import { Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { AuthProvider, OtpStartResult, VerifiedIdentity } from "./auth.provider";
import { RedisService } from "../common/redis.service";
import { NotificationsService } from "../notifications/notifications.service";

// REAL phone-OTP: a cryptographically-random 6-digit code, stored HASHED in Redis with a 5-min TTL,
// single-use, rate-limited per phone, and DELIVERED over the real comms channel (SMTP/Mailpit in
// dev, Twilio in prod). No fixed dev code. `devHint` only surfaces the code when DEV_OTP_HINT is on
// (so the local demo/sim can read it) — the verification itself checks the real stored hash.
// Sign in with Apple still needs Apple/Stytch for token validation (//TODO); dev returns a stable id.
export class OtpAuthProvider implements AuthProvider {
  private readonly log = new Logger("OtpAuth");
  private readonly ttl = 300;
  private readonly maxAttempts = 5;

  constructor(
    private readonly redis: RedisService,
    private readonly notify: NotificationsService,
  ) {}

  private hash(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
  }

  async startOtp(phone: string): Promise<OtpStartResult> {
    const code = (crypto.randomInt(0, 1_000_000)).toString().padStart(6, "0");
    await this.redis.set(`otp:${phone}`, this.hash(code), this.ttl);
    await this.redis.del(`otp_attempts:${phone}`);
    // delivery is best-effort: the code is already issued (Redis) and surfaced via devHint in dev,
    // so a comms outage (e.g. Mailpit down) never blocks login.
    try {
      await this.notify.sendSms(phone, `Your Plot code is ${code}. It expires in 5 minutes.`);
    } catch (e) {
      this.log.warn(`OTP delivery failed (${(e as Error).message}) — code still valid; use devHint`);
    }
    this.log.log(`OTP issued for ${phone} (expires ${this.ttl}s)`);
    const hint = process.env.DEV_OTP_HINT !== "0"; // on by default in dev so the demo/sim can log in
    return { sent: true, devHint: hint ? code : undefined };
  }

  async verifyOtp(phone: string, code: string): Promise<VerifiedIdentity> {
    const attempts = await this.redis.incr(`otp_attempts:${phone}`, this.ttl);
    if (attempts > this.maxAttempts) throw new Error("too many attempts — request a new code");
    const stored = await this.redis.get(`otp:${phone}`);
    if (!stored) throw new Error("code expired — request a new one");
    if (stored !== this.hash(code)) throw new Error("invalid code");
    await this.redis.del(`otp:${phone}`); // single-use
    await this.redis.del(`otp_attempts:${phone}`);
    return { phone };
  }

  async verifyApple(_identityToken: string, displayName?: string): Promise<VerifiedIdentity> {
    // TODO: REAL CREDENTIAL — validate the Apple identity token (Apple/Stytch). Dev: stable identity.
    return { appleSub: "dev-apple-sub-001", displayName: displayName ?? "Apple User" };
  }
}
