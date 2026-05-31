// AuthProvider — the seam between PLOT and a real auth backend (Stytch).
// The dev MockAuthProvider implements the SAME interface so the app runs with zero keys.

export interface OtpStartResult {
  sent: boolean;
  devHint?: string; // dev only: the code to enter
}

export interface VerifiedIdentity {
  phone?: string;
  appleSub?: string;
  displayName?: string;
}

export interface AuthProvider {
  startOtp(phone: string): Promise<OtpStartResult>;
  verifyOtp(phone: string, code: string): Promise<VerifiedIdentity>;
  verifyApple(identityToken: string, displayName?: string): Promise<VerifiedIdentity>;
}

export const AUTH_PROVIDER = Symbol("AUTH_PROVIDER");
