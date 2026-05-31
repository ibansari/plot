import { Module } from "@nestjs/common";
import { MoneyService } from "./money.service";
import { MoneyController, MoneyPublicController } from "./money.controller";
import { PAYMENT_PROVIDER } from "./payment.provider";
import { MockPaymentProvider } from "./payment.mock";
import { StripeConnectProvider } from "./payment.stripe";
import { config } from "../common/config";

@Module({
  controllers: [MoneyController, MoneyPublicController],
  providers: [
    MoneyService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () =>
        config.paymentProvider === "stripe" ? new StripeConnectProvider() : new MockPaymentProvider(),
    },
  ],
  exports: [MoneyService],
})
export class MoneyModule {}
