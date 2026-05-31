import { Comms } from "./comms.types";

// Real Twilio SMS. Same interface as MockComms.
// TODO: REAL CREDENTIAL — set TWILIO_* and COMMS_PROVIDER=twilio.
export class TwilioComms implements Comms {
  // private client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  async sendSms(_to: string, _body: string): Promise<{ sid: string }> {
    // const msg = await this.client.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body });
    // return { sid: msg.sid };
    throw new Error("TwilioComms not configured — set TWILIO_* keys, or use COMMS_PROVIDER=mock");
  }
}
