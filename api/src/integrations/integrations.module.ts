import { Module } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { CALENDAR_PROVIDER, PLACES_PROVIDER } from "./integrations.types";
import { MockCalendarProvider } from "./calendar.mock";
import { GoogleCalendarProvider } from "./calendar.google";
import { MockPlacesProvider } from "./places.mock";
import { GooglePlacesProvider } from "./places.google";
import { PrismaService } from "../common/prisma.service";
import { config } from "../common/config";

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    {
      provide: CALENDAR_PROVIDER,
      useFactory: (prisma: PrismaService) =>
        config.calendarProvider === "google"
          ? new GoogleCalendarProvider()
          : new MockCalendarProvider(prisma),
      inject: [PrismaService],
    },
    {
      provide: PLACES_PROVIDER,
      useFactory: () =>
        config.placesProvider === "google" ? new GooglePlacesProvider() : new MockPlacesProvider(),
    },
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
