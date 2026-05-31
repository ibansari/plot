import { Logger } from "@nestjs/common";
import { Comms, Push } from "./comms.types";

// Working dev comms: logs the "SMS" prominently so you can copy the vote link into a browser.
// This is what makes the non-user bridge work in the slice with zero Twilio keys.
export class MockComms implements Comms {
  private readonly log = new Logger("MockSMS");
  async sendSms(to: string, body: string): Promise<{ sid: string }> {
    this.log.log("\n┌─────────────── 📱 MOCK SMS ───────────────");
    this.log.log(`│ to: ${to}`);
    body.split("\n").forEach((l) => this.log.log(`│ ${l}`));
    this.log.log("└───────────────────────────────────────────\n");
    return { sid: `mock-sms-${Date.now()}` };
  }
}

export class MockPush implements Push {
  private readonly log = new Logger("MockPush");
  async send(apnsToken: string, payload: { title: string; body: string }): Promise<void> {
    this.log.log(`[mock APNs → ${apnsToken}] ${payload.title}: ${payload.body}`);
  }
}
