import { AuditService } from "../src/common/audit.service";
import { AuditAction, PlanState } from "@plot/db";

// audit + undo: undoing an auto-lock must apply the recorded compensating action (UNLOCK_PLAN),
// flip the row's undoneAt, and write a new immutable row for the compensation.
describe("AuditService.undo (reversibility, §13)", () => {
  function makeService() {
    const created: any[] = [];
    const planUpdates: any[] = [];
    const auditUpdates: any[] = [];

    const prisma: any = {
      auditLog: {
        findUnique: jest.fn(async () => ({
          id: "a_lock",
          planId: "p1",
          actor: "plot",
          action: AuditAction.AGENT_LOCKED_PLAN,
          summary: 'Locked leader "Fri 7:30p @ Ananda Thai"',
          undo: { type: "UNLOCK_PLAN", planId: "p1", prevState: PlanState.VOTING },
          undoneAt: null,
        })),
        update: jest.fn(async (args: any) => { auditUpdates.push(args); return {}; }),
        create: jest.fn(async (args: any) => { const row = { id: "a_undo", ...args.data, createdAt: new Date() }; created.push(row); return row; }),
      },
      plan: {
        update: jest.fn(async (args: any) => { planUpdates.push(args); return { id: "p1", threadId: "t_crew" }; }),
        findUnique: jest.fn(async () => ({ id: "p1", threadId: "t_crew" })),
      },
    };
    const realtime: any = { emitToThread: jest.fn() };
    return { svc: new AuditService(prisma, realtime), prisma, realtime, planUpdates, auditUpdates, created };
  }

  it("applies UNLOCK_PLAN, marks the row undone, and records the compensation", async () => {
    const { svc, prisma, planUpdates, auditUpdates, created, realtime } = makeService();

    const res = await svc.undo("a_lock");

    expect(res.ok).toBe(true);
    expect(res.action).toBe("UNLOCK_PLAN");
    // plan rolled back to VOTING with lock fields cleared
    expect(planUpdates[0].data.state).toBe(PlanState.VOTING);
    expect(planUpdates[0].data.lockedOptionId).toBeNull();
    // original row flagged undone
    expect(auditUpdates[0].data.undoneAt).toBeInstanceOf(Date);
    // a compensating audit row was written
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(created.some((r) => r.action === AuditAction.PLAN_UNLOCKED)).toBe(true);
    // clients were notified the plan changed
    expect(realtime.emitToThread).toHaveBeenCalledWith("t_crew", "plan.updated", expect.anything());
  });

  it("is idempotent — undoing an already-undone row is a no-op", async () => {
    const { svc, prisma } = makeService();
    prisma.auditLog.findUnique = jest.fn(async () => ({ id: "a_lock", undo: { type: "UNLOCK_PLAN", planId: "p1", prevState: PlanState.VOTING }, undoneAt: new Date() }));
    const res = await svc.undo("a_lock");
    expect(res.action).toBe("noop");
    expect(prisma.plan?.update).toBeUndefined; // not touched
  });
});
