import { BookingAttempt, BookingProvider } from "./booking.provider";

// Stub: never books, always returns a graceful fallback (tap-to-call or deep link). This is the
// correct slice behaviour — a locked plan needs no booking; the UI offers a fallback CTA.
// TODO: REAL CREDENTIAL — implement OpenTableProvider/ResyProvider behind this same interface.
export class StubBookingProvider implements BookingProvider {
  async book(opts: { place: string; phone?: string; url?: string }): Promise<BookingAttempt> {
    if (opts.phone) {
      return { booked: false, fallback: { kind: "call", value: opts.phone, label: `Call ${opts.place}` } };
    }
    if (opts.url) {
      return { booked: false, fallback: { kind: "link", value: opts.url, label: `Book ${opts.place}` } };
    }
    return { booked: false, fallback: { kind: "link", value: "", label: "No booking available" } };
  }
}
