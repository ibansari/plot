import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { COMMS, PUSH } from "./comms.types";
import { MockComms, MockPush } from "./comms.mock";
import { TwilioComms } from "./comms.twilio";
import { ApnsPush } from "./push.apns";
import { config } from "../common/config";

@Module({
  providers: [
    NotificationsService,
    { provide: COMMS, useFactory: () => (config.commsProvider === "twilio" ? new TwilioComms() : new MockComms()) },
    { provide: PUSH, useFactory: () => (config.pushProvider === "apns" ? new ApnsPush() : new MockPush()) },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
