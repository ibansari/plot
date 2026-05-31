import { Inject, Injectable, Logger } from "@nestjs/common";
import { PermissionScope } from "@plot/db";
import { PrismaService } from "../common/prisma.service";
import {
  CALENDAR_PROVIDER,
  PLACES_PROVIDER,
  CalendarProvider,
  PlacesProvider,
  BusyInterval,
  PlaceResult,
} from "./integrations.types";

export interface AvailabilitySummary {
  windowFrom: string;
  windowTo: string;
  perMember: { userId: string; name: string; busy: BusyInterval[] }[];
  // suggested free slots where the most members are free
  suggestions: { startsAt: string; endsAt: string; freeCount: number }[];
}

@Injectable()
export class IntegrationsService {
  private readonly log = new Logger("Integrations");
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CALENDAR_PROVIDER) private readonly calendar: CalendarProvider,
    @Inject(PLACES_PROVIDER) private readonly places: PlacesProvider,
  ) {}

  // Default-deny permission check (§13). Returns true if user OR group granted the scope.
  private async hasPermission(userId: string, groupId: string, scope: PermissionScope) {
    const grant = await this.prisma.permission.findFirst({
      where: {
        scope,
        granted: true,
        OR: [{ userId }, { groupId, userId: null }, { userId, groupId }],
      },
    });
    return !!grant;
  }

  // gather-availability node: busy/free for every member who granted calendar access.
  async gatherAvailability(groupId: string, fromIso: string, toIso: string): Promise<AvailabilitySummary> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, userId: { not: null } },
      include: { user: true },
    });
    const perMember: AvailabilitySummary["perMember"] = [];
    for (const m of members) {
      if (!m.user) continue;
      const ok = await this.hasPermission(m.user.id, groupId, this.calendar.requiredScope);
      // graceful degradation: no permission → treat as unknown (empty busy), don't throw
      const busy = ok ? await this.safe(() => this.calendar.getBusy(m.user!.id, fromIso, toIso)) : [];
      perMember.push({ userId: m.user.id, name: m.user.displayName, busy });
    }
    return {
      windowFrom: fromIso,
      windowTo: toIso,
      perMember,
      suggestions: this.computeFreeSlots(fromIso, toIso, perMember),
    };
  }

  // research node: candidate venues. Permission-checked per requesting user.
  async researchPlaces(userId: string, groupId: string, query: string, near?: string): Promise<PlaceResult[]> {
    const ok = await this.hasPermission(userId, groupId, this.places.requiredScope);
    if (!ok) {
      this.log.warn(`places search denied for ${userId} (no scope) — degrading to empty`);
      return [];
    }
    return this.safe(() => this.places.search(query, near));
  }

  // Slice free slots over the window in 30-min steps; rank by how many members are free.
  private computeFreeSlots(
    fromIso: string,
    toIso: string,
    perMember: AvailabilitySummary["perMember"],
  ) {
    const from = new Date(fromIso).getTime();
    const to = new Date(toIso).getTime();
    const step = 30 * 60_000;
    const slotLen = 90 * 60_000; // propose 90-min slots
    const out: { startsAt: string; endsAt: string; freeCount: number }[] = [];
    for (let t = from; t + slotLen <= to; t += step) {
      const s = t;
      const e = t + slotLen;
      let freeCount = 0;
      for (const m of perMember) {
        const overlaps = m.busy.some(
          (b) => new Date(b.startsAt).getTime() < e && new Date(b.endsAt).getTime() > s,
        );
        if (!overlaps) freeCount++;
      }
      out.push({ startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), freeCount });
    }
    return out.sort((a, b) => b.freeCount - a.freeCount).slice(0, 3);
  }

  private async safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
    try {
      return await fn();
    } catch (e) {
      this.log.warn(`connector degraded: ${e}`);
      return [];
    }
  }
}
