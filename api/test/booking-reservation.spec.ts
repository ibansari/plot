import { ReservationBookingProvider } from "../src/plan/booking/booking.reservation";

// The real internal booking engine: confirms when the party fits the venue's capacity for the time
// window, degrades to tap-to-call otherwise. Pure logic verified offline with a fake Prisma (no DB).
describe("ReservationBookingProvider (real capacity/conflict engine)", () => {
  function make(opts: { capacity?: number; existing?: number[] }) {
    const created: unknown[] = [];
    const prisma: any = {
      place: { findFirst: jest.fn(async () => (opts.capacity != null ? { capacity: opts.capacity } : null)) },
      reservation: {
        findMany: jest.fn(async () => (opts.existing ?? []).map((p) => ({ partySize: p }))),
        create: jest.fn(async (a: any) => { created.push(a.data); return a.data; }),
      },
    };
    return { svc: new ReservationBookingProvider(prisma), prisma, created };
  }

  const slot = { place: "Ananda Thai", time: "2026-06-05T19:00:00.000Z", partySize: 5, phone: "+15551112222" };

  it("confirms a reservation when the party fits capacity", async () => {
    const { svc, prisma, created } = make({ capacity: 40, existing: [10, 8] }); // 18 taken + 5 = 23 ≤ 40
    const r = await svc.book(slot);
    expect(r.booked).toBe(true);
    expect(r.confirmation).toMatch(/^PLOT-[0-9A-F]+$/);
    expect(prisma.reservation.create).toHaveBeenCalledTimes(1);
    expect((created[0] as { partySize: number }).partySize).toBe(5);
  });

  it("degrades to tap-to-call when the slot is over capacity", async () => {
    const { svc, prisma } = make({ capacity: 40, existing: [20, 18] }); // 38 + 5 = 43 > 40
    const r = await svc.book(slot);
    expect(r.booked).toBe(false);
    expect(r.fallback).toEqual({ kind: "call", value: "+15551112222", label: "Call Ananda Thai" });
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it("uses a default capacity for venues not in the catalog (e.g. OSM results)", async () => {
    const { svc } = make({ existing: [] }); // place.findFirst → null → default capacity 40
    const r = await svc.book({ ...slot, place: "Some OSM Bar" });
    expect(r.booked).toBe(true);
  });

  it("degrades when there is no venue to book", async () => {
    const { svc } = make({});
    const r = await svc.book({ place: "", time: slot.time, partySize: 5, phone: "+15551112222" });
    expect(r.booked).toBe(false);
    expect(r.fallback?.kind).toBe("call");
  });
});
