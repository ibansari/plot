import { Injectable } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { BusyInterval, CalendarProvider } from "./integrations.types";

// Real Google Calendar freeBusy connector. Same interface as the mock.
// TODO: REAL CREDENTIAL — OAuth per user; call calendar.freebusy.query and map to BusyInterval[].
// Crucially still returns busy/free only (§13): we never read event summaries.
@Injectable()
export class GoogleCalendarProvider implements CalendarProvider {
  readonly requiredScope = PermissionScope.CALENDAR_BUSYFREE;
  async getBusy(_userId: string, _fromIso: string, _toIso: string): Promise<BusyInterval[]> {
    // const { data } = await google.calendar('v3').freebusy.query({ ... });
    // return data.calendars[primary].busy.map(b => ({ startsAt: b.start, endsAt: b.end }));
    throw new Error("GoogleCalendarProvider not configured — use CALENDAR_PROVIDER=mock");
  }
}
