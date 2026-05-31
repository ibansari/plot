import { Module } from "@nestjs/common";
import { PlanService } from "./plan.service";
import { PlanController } from "./plan.controller";
import { BOOKING_PROVIDER } from "./booking/booking.provider";
import { MockBookingProvider } from "./booking/booking.mock";
import { StubBookingProvider } from "./booking/booking.stub";
import { config } from "../common/config";

@Module({
  controllers: [PlanController],
  providers: [
    PlanService,
    // BOOKING_PROVIDER: "mock" actually books (+ degrades when no venue); "stub" always degrades;
    // real OpenTable/Resy/DICE plug in behind the same interface (//TODO).
    {
      provide: BOOKING_PROVIDER,
      useFactory: () => (config.bookingProvider === "stub" ? new StubBookingProvider() : new MockBookingProvider()),
    },
  ],
  exports: [PlanService],
})
export class PlanModule {}
