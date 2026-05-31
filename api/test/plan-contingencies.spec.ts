import { AuditAction } from "@plot/db";
import { PlanService } from "../src/plan/plan.service";

// Self-enforcing contingencies (§8 H) — the second option is the backup, outdoor picks get a
// weather fallback, and every plan gets a late-start rebalance. setContingencies persists them and
// writes a reversible (CLEAR_CONTINGENCIES) audit row.
describe("PlanService contingencies", () => {
  function makeService() {
    const prisma: any = {
      plan: { update: jest.fn(async () => ({ id: "p1", threadId: "t1" })) },
    };
    const audit: any = { record: jest.fn(async () => ({})) };
    const realtime: any = { emitToThread: jest.fn() };
    const inngest: any = { send: jest.fn() };
    const recall: any = { remember: jest.fn(async () => ({})), recall: jest.fn(async () => []) };
    const booking: any = { book: jest.fn() };
    const svc = new PlanService(prisma, audit, realtime, inngest, recall, booking);
    return { svc, prisma, audit, realtime };
  }

  it("makes the second option the backup", () => {
    const { svc } = makeService();
    const opts = [
      { id: "o1", label: "Fri 7:30p @ Ananda Thai", place: "Ananda Thai", startsAt: new Date() },
      { id: "o2", label: "Fri 8p @ Joe's Pizza", place: "Joe's Pizza", startsAt: new Date() },
    ];
    const cs = svc.defaultContingencies(opts);
    const backup = cs.find((c) => c.type === "switch_backup");
    expect(backup).toBeDefined();
    expect(backup!.backupOptionId).toBe("o2");
    // always carries a late-start rebalance
    expect(cs.some((c) => c.type === "rebalance")).toBe(true);
  });

  it("adds a weather fallback for outdoor options", () => {
    const { svc } = makeService();
    const cs = svc.defaultContingencies([
      { id: "o1", label: "Drinks @ Pier 17 Rooftop", place: "Pier 17 Rooftop", startsAt: null },
      { id: "o2", label: "Indoor backup", place: "The Back Room", startsAt: null },
    ]);
    expect(cs.some((c) => c.type === "hold" && /forecast/i.test(c.ifText))).toBe(true);
  });

  it("omits the backup contingency when there is only one option", () => {
    const { svc } = makeService();
    const cs = svc.defaultContingencies([{ id: "o1", label: "Solo", place: null, startsAt: null }]);
    expect(cs.some((c) => c.type === "switch_backup")).toBe(false);
  });

  it("persists contingencies and writes a reversible audit row", async () => {
    const { svc, prisma, audit, realtime } = makeService();
    const cs = [{ ifText: "x", thenText: "y", type: "hold" }];
    await svc.setContingencies("p1", cs as any, { silent: true });
    expect(prisma.plan.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { contingencies: cs },
    });
    const call = audit.record.mock.calls[0][0];
    expect(call.action).toBe(AuditAction.AGENT_SET_CONTINGENCIES);
    expect(call.undo).toEqual({ type: "CLEAR_CONTINGENCIES", planId: "p1" });
    // silent → no re-broadcast
    expect(realtime.emitToThread).not.toHaveBeenCalled();
  });
});
