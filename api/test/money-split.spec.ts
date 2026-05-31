import { AuditAction, PermissionScope } from "@plot/db";
import { MoneyController } from "../src/money/money.controller";

// Auto-split is least-authority (§13): no SPEND_MONEY grant → no money moves, agent is told to ask.
// With the grant, an even split is created and a reversible (REFUND_SPLIT) audit row is written.
describe("MoneyController.split (§B1)", () => {
  function make(granted: boolean) {
    const prisma: any = {
      plan: { findUniqueOrThrow: jest.fn(async () => ({ id: "p1", groupId: "g1", threadId: "t1", title: "Dinner" })) },
      permission: { findFirst: jest.fn(async () => (granted ? { id: "perm1" } : null)) },
      groupMember: { count: jest.fn(async () => 5) },
    };
    const money: any = {
      createEvenSplit: jest.fn(async (_planId: string, total: number) => ({
        id: "sp1",
        state: "HELD",
        shares: [{ amountCents: Math.floor(total / 5) }],
      })),
    };
    const audit: any = { record: jest.fn(async () => ({})) };
    return { ctrl: new MoneyController(money, prisma, audit), money, audit };
  }

  it("creates an even split and a reversible audit row when granted", async () => {
    const { ctrl, money, audit } = make(true);
    const res = await ctrl.split("p1", { perHeadCents: 4000 });
    expect(res.created).toBe(true);
    // total = perHead * members = 4000 * 5
    expect(money.createEvenSplit).toHaveBeenCalledWith("p1", 20000, expect.any(String));
    expect(res.split!.perHeadCents).toBe(4000);
    const call = audit.record.mock.calls[0][0];
    expect(call.action).toBe(AuditAction.AGENT_CREATED_SPLIT);
    expect(call.undo.type).toBe("REFUND_SPLIT");
  });

  it("moves no money and reports needsPermission when not granted", async () => {
    const { ctrl, money, audit } = make(false);
    const res = await ctrl.split("p1", { perHeadCents: 4000 });
    expect(res).toEqual({ created: false, needsPermission: true, scope: PermissionScope.SPEND_MONEY });
    expect(money.createEvenSplit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
