import { Logger } from "@nestjs/common";
import { BookingAttempt, BookingProvider } from "./booking.provider";

// Working booking mock: "books" a venue/ticket and returns a confirmation code. If there is no
// bookable place (only a phone/url), it degrades gracefully to tap-to-call / deep-link — exactly
// the fallback a real provider must offer. Real OpenTable/Resy/DICE go behind this same interface.
export class MockBookingProvider implements BookingProvider {
  private readonly log = new Logger("MockBooking");
  private seq = 0;

  async book(opts: { place: string; time: string; partySize: number; phone?: string; url?: string }): Promise<BookingAttempt> {
    if (opts.place && opts.place.trim()) {
      const confirmation = `PLOT-${(1000 + ++this.seq).toString(36).toUpperCase()}`;
      this.log.log(`[booking] CONFIRMED ${opts.partySize}× @ ${opts.place} ${opts.time} → ${confirmation}`);
      return { booked: true, confirmation };
    }
    // graceful degradation (no integration for this venue)
    if (opts.phone) return { booked: false, fallback: { kind: "call", value: opts.phone, label: `Call to book` } };
    if (opts.url) return { booked: false, fallback: { kind: "link", value: opts.url, label: `Book online` } };
    return { booked: false, fallback: { kind: "link", value: "", label: "No booking available" } };
  }
}
