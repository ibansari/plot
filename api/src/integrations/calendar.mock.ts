import { Injectable } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { PrismaService } from "../common/prisma.service";
import { BusyInterval, CalendarProvider } from "./integrations.types";

// Reads busy/free from the AvailabilityWindow table (populated by iOS EventKit sync / seed).
// This is the slice's working calendar: real data path, no external API.
@Injectable()
export class MockCalendarProvider implements CalendarProvider {
  readonly requiredScope = PermissionScope.CALENDAR_BUSYFREE;
  constructor(private readonly prisma: PrismaService) {}

  async getBusy(userId: string, fromIso: string, toIso: string): Promise<BusyInterval[]> {
    const rows = await this.prisma.availabilityWindow.findMany({
      where: {
        userId,
        busy: true,
        startsAt: { lt: new Date(toIso) },
        endsAt: { gt: new Date(fromIso) },
      },
      orderBy: { startsAt: "asc" },
    });
    return rows.map((r) => ({ startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
  }
}
