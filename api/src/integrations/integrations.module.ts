import { Module } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { CALENDAR_PROVIDER, PLACES_PROVIDER } from "./integrations.types";
import { MockCalendarProvider } from "./calendar.mock";
import { GoogleCalendarProvider } from "./calendar.google";
import { MockPlacesProvider } from "./places.mock";
import { DbPlacesProvider } from "./places.db";
import { OsmPlacesProvider } from "./places.osm";
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
      // "osm" = REAL live OpenStreetMap fetch (no key) w/ DB fallback (default) · "db" = local
      // catalog query · "google" = live Google (//TODO key) · "mock" = canned
      provide: PLACES_PROVIDER,
      useFactory: (prisma: PrismaService) => {
        switch (config.placesProvider) {
          case "google":
            return new GooglePlacesProvider();
          case "mock":
            return new MockPlacesProvider();
          case "db":
            return new DbPlacesProvider(prisma);
          default:
            return new OsmPlacesProvider(new DbPlacesProvider(prisma)); // osm + DB fallback
        }
      },
      inject: [PrismaService],
    },
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
