import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../../common/prisma.service";
import { BookingAttempt, BookingProvider } from "./booking.provider";

// REAL internal reservation engine — no external partner, no key. Books against a venue's seat
// capacity with genuine overlap-conflict checking: if the requested party fits within capacity for
// the time window it confirms (persisting a Reservation row + a confirmation code); otherwise it
// DEGRADES GRACEFULLY to tap-to-call / deep-link. This is how a venue's own system works; a real
// OpenTable/Resy/DICE connector would slot in behind this same interface (//TODO partner access).
@Injectable()
export class ReservationBookingProvider implements BookingProvider {
  private readonly log = new Logger("Reservations");
  private readonly DEFAULT_CAPACITY = 40;
  private readonly SLOT_HOURS = 2;
  constructor(private readonly prisma: PrismaService) {}

  async book(opts: { place: string; time: string; partySize: number; phone?: string; url?: string }): Promise<BookingAttempt> {
    const place = opts.place?.trim();
    const start = opts.time ? new Date(opts.time) : new Date();
    const end = new Date(start.getTime() + this.SLOT_HOURS * 3600_000);

    if (!place) return this.degrade(opts);

    // capacity for this venue (from the catalog if known, else a sane default)
    const venue = await this.prisma.place.findFirst({ where: { name: { equals: place, mode: "insensitive" } } });
    const capacity = venue?.capacity ?? this.DEFAULT_CAPACITY;

    // sum confirmed reservations overlapping the requested window
    const overlapping = await this.prisma.reservation.findMany({
      where: {
        placeName: place,
        status: "CONFIRMED",
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      select: { partySize: true },
    });
    const taken = overlapping.reduce((s, r) => s + r.partySize, 0);

    if (taken + opts.partySize > capacity) {
      this.log.warn(`${place} full for that slot (${taken}/${capacity}) — degrading to fallback`);
      return this.degrade(opts);
    }

    const confirmation = `PLOT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    await this.prisma.reservation.create({
      data: { placeName: place, startsAt: start, endsAt: end, partySize: opts.partySize, confirmation },
    });
    this.log.log(`CONFIRMED ${opts.partySize}× @ ${place} ${start.toISOString()} → ${confirmation} (${taken + opts.partySize}/${capacity})`);
    return { booked: true, confirmation };
  }

  private degrade(opts: { place: string; phone?: string; url?: string }): BookingAttempt {
    if (opts.phone) return { booked: false, fallback: { kind: "call", value: opts.phone, label: `Call ${opts.place || "the venue"}` } };
    if (opts.url) return { booked: false, fallback: { kind: "link", value: opts.url, label: `Book ${opts.place || "online"}` } };
    return { booked: false, fallback: { kind: "link", value: "", label: "No booking available" } };
  }
}
