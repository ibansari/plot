// BookingProvider — SCAFFOLDED. The plan resolves (LOCKED = time+place+RSVP) WITHOUT booking.
// Booking is an additive enrichment that attaches a confirmation to an already-locked plan, and
// MUST degrade gracefully (tap-to-call / deep link) when no integration exists.

export interface BookingAttempt {
  booked: boolean;
  confirmation?: string;
  // graceful degradation surface when not booked
  fallback?: { kind: "call" | "link"; value: string; label: string };
}

export interface BookingProvider {
  book(opts: { place: string; time: string; partySize: number; phone?: string; url?: string }): Promise<BookingAttempt>;
}

export const BOOKING_PROVIDER = Symbol("BOOKING_PROVIDER");
