import { AuthProvider, OtpStartResult, VerifiedIdentity } from "./auth.provider";

// Real Stytch-backed auth. Implements the same interface as the mock.
// TODO: REAL CREDENTIAL — set STYTCH_PROJECT_ID / STYTCH_SECRET and AUTH_PROVIDER=stytch.
export class StytchAuthProvider implements AuthProvider {
  // private client = new stytch.Client({ project_id: ..., secret: ... });

  async startOtp(_phone: string): Promise<OtpStartResult> {
    // return this.client.otps.sms.loginOrCreate({ phone_number: _phone });
    throw new Error("StytchAuthProvider not configured — set STYTCH keys, or use AUTH_PROVIDER=mock");
  }
  async verifyOtp(_phone: string, _code: string): Promise<VerifiedIdentity> {
    throw new Error("StytchAuthProvider not configured");
  }
  async verifyApple(_identityToken: string): Promise<VerifiedIdentity> {
    // validate the Apple identity token via Stytch OAuth, return { appleSub }
    throw new Error("StytchAuthProvider not configured");
  }
}
