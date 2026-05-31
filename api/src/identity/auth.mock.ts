import { Logger } from "@nestjs/common";
import { AuthProvider, OtpStartResult, VerifiedIdentity } from "./auth.provider";

// Working dev auth. OTP code is always 000000. Apple returns a canned identity. No keys needed.
export class MockAuthProvider implements AuthProvider {
  private readonly log = new Logger("MockAuth");
  static readonly DEV_CODE = "000000";

  async startOtp(phone: string): Promise<OtpStartResult> {
    this.log.log(`[mock OTP] to ${phone}: code is ${MockAuthProvider.DEV_CODE}`);
    return { sent: true, devHint: MockAuthProvider.DEV_CODE };
  }

  async verifyOtp(phone: string, code: string): Promise<VerifiedIdentity> {
    if (code !== MockAuthProvider.DEV_CODE) throw new Error("invalid code (dev code is 000000)");
    return { phone };
  }

  async verifyApple(_identityToken: string, displayName?: string): Promise<VerifiedIdentity> {
    // dev mock ignores the token value entirely
    return { appleSub: "mock-apple-sub-001", displayName: displayName ?? "Apple User" };
  }
}
