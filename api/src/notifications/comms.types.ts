// Comms — outbound SMS to non-users (the bridge that lets someone vote without the app).
// MockComms logs the message and returns; the actual link is served by /web. TwilioComms is the
// real impl behind the same interface.
export interface Comms {
  sendSms(to: string, body: string): Promise<{ sid: string }>;
}

// Push — APNs to app users. MockPush logs token+payload.
export interface Push {
  send(apnsToken: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
}

export const COMMS = Symbol("COMMS");
export const PUSH = Symbol("PUSH");
