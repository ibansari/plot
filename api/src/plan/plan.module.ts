import { Module } from "@nestjs/common";
import { PlanService } from "./plan.service";
import { PlanController } from "./plan.controller";
import { BOOKING_PROVIDER } from "./booking/booking.provider";
import { ReservationBookingProvider } from "./booking/booking.reservation";
import { MockBookingProvider } from "./booking/booking.mock";
import { StubBookingProvider } from "./booking/booking.stub";
import { PrismaService } from "../common/prisma.service";
import { config } from "../common/config";

@Module({
  controllers: [PlanController],
  providers: [
    PlanService,
    // BOOKING_PROVIDER: "reservation" (default) = REAL internal engine (capacity + conflict checks)
    // · "mock" = always-confirm · "stub" = always-degrade · real partner (OpenTable/Resy/DICE) //TODO.
    {
      provide: BOOKING_PROVIDER,
      useFactory: (prisma: PrismaService) => {
        switch (config.bookingProvider) {
          case "stub":
            return new StubBookingProvider();
          case "mock":
            return new MockBookingProvider();
          default:
            return new ReservationBookingProvider(prisma);
        }
      },
      inject: [PrismaService],
    },
  ],
  exports: [PlanService],
})
export class PlanModule {}
