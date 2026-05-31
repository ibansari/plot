import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { COMMS, PUSH } from "./comms.types";
import { MockComms, MockPush } from "./comms.mock";
import { SmtpComms } from "./comms.smtp";
import { TwilioComms } from "./comms.twilio";
import { ApnsPush } from "./push.apns";
import { config } from "../common/config";

@Module({
  providers: [
    NotificationsService,
    {
      // "smtp" = real SMTP delivery (Mailpit) | "twilio" = real SMS | "mock" = log only
      provide: COMMS,
      useFactory: () =>
        config.commsProvider === "twilio"
          ? new TwilioComms()
          : config.commsProvider === "smtp"
            ? new SmtpComms()
            : new MockComms(),
    },
    { provide: PUSH, useFactory: () => (config.pushProvider === "apns" ? new ApnsPush() : new MockPush()) },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
