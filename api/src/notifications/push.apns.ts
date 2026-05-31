import { Push } from "./comms.types";

// Real APNs push. Same interface as MockPush.
// TODO: REAL CREDENTIAL — APNS_KEY_ID / APNS_TEAM_ID / .p8 key; PUSH_PROVIDER=apns.
export class ApnsPush implements Push {
  async send(_apnsToken: string, _payload: { title: string; body: string }): Promise<void> {
    throw new Error("ApnsPush not configured — use PUSH_PROVIDER=mock");
  }
}
