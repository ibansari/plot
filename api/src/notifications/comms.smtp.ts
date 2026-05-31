import { Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { Comms } from "./comms.types";
import { config } from "../common/config";

// REAL message delivery over SMTP (no carrier/account). In dev this targets Mailpit
// (localhost:1025), so non-user invites are genuinely sent over SMTP and viewable at
// http://localhost:8025. SMS-to-email gateways (e.g. number@carrier) make this reach phones too.
// The signed vote/RSVP/pay link is delivered for real; only the cellular SMS leg (Twilio) is absent.
export class SmtpComms implements Comms {
  private readonly log = new Logger("SMTP");
  private readonly tx = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  async sendSms(to: string, body: string): Promise<{ sid: string }> {
    // route to an email address (phone→email gateway in prod); local recipients land in Mailpit.
    const toAddr = to.includes("@") ? to : `${to.replace(/[^0-9]/g, "")}@sms.plot.local`;
    const info = await this.tx.sendMail({
      from: config.smtpFrom,
      to: toAddr,
      subject: "Plot — you're invited to weigh in",
      text: body,
    });
    this.log.log(`SMTP → ${toAddr} (${info.messageId}) · view at http://localhost:8025`);
    return { sid: info.messageId };
  }
}
