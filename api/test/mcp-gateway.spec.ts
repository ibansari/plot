import { McpGatewayService, McpExecutor } from "../src/integrations/mcp/mcp-gateway.service";
import { McpRenderService } from "../src/integrations/mcp/mcp-render.service";

// §Transaction Lifecycle: reads execute immediately; mutations create a preview + approval and do
// NOT execute; organizer-policy actions require an organizer; credentials/origins never persisted.
describe("McpGatewayService lifecycle", () => {
  function harness(execImpl?: McpExecutor["call"]) {
    const store: any = { inv: {}, appr: {}, receipts: [] };
    const prisma: any = {
      integrationInvocation: {
        create: jest.fn(async ({ data }: any) => ((store.inv[data.serverKey + data.toolName] = { id: "inv1", ...data }))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(store.inv, { [where.id]: { ...data, id: where.id } })),
      },
      externalActionApproval: {
        create: jest.fn(async ({ data }: any) => ((store.appr["ap1"] = { id: "ap1", state: "PENDING", ...data }))),
        findUniqueOrThrow: jest.fn(async ({ where }: any) => ({ ...store.appr[where.id], invocation: { id: "inv1", serverKey: "resy", toolName: store.lastTool, risk: store.lastRisk, sanitizedInput: store.lastInput } })),
        update: jest.fn(async ({ where, data }: any) => Object.assign(store.appr[where.id], data)),
      },
      externalActionReceipt: { create: jest.fn(async ({ data }: any) => store.receipts.push(data)) },
    };
    const audit: any = { record: jest.fn(async () => ({})) };
    const executor: McpExecutor | undefined = execImpl ? { call: jest.fn(execImpl) } : undefined;
    const svc = new McpGatewayService(prisma, new McpRenderService(), audit, executor);
    return { svc, prisma, executor, store };
  }

  it("executes a READ tool immediately and returns a READY envelope", async () => {
    const { svc, executor } = harness(async () => ({ content: JSON.stringify([{ name: "Yopparai" }]) }));
    const out = await svc.invoke({ serverKey: "resy", toolName: "search_restaurants", input: { query: "izakaya" }, groupId: "g" });
    expect(out.status).toBe("READY");
    expect((executor!.call as jest.Mock)).toHaveBeenCalled();
    expect(out.envelope.renderer).toBe("LIST");
    expect(out.approvalId).toBeUndefined();
  });

  it("does NOT execute a PURCHASE tool — it previews and needs organizer approval", async () => {
    const { svc, executor } = harness(async () => ({ confirmation: "X" }));
    const out = await svc.invoke({ serverKey: "tm", toolName: "purchase_tickets", input: { qty: 2 }, groupId: "g", preview: { provider: "Ticketmaster", total: "$120" } });
    expect(out.status).toBe("NEEDS_APPROVAL");
    expect(out.envelope.renderer).toBe("APPROVAL");
    expect(out.approvalId).toBe("ap1");
    expect((executor!.call as jest.Mock)).not.toHaveBeenCalled(); // gate held — no execution
  });

  it("redacts credentials/origins from the persisted invocation input", async () => {
    const { svc, prisma } = harness(async () => ({}));
    await svc.invoke({ serverKey: "x", toolName: "search", input: { query: "ok", authorization: "Bearer SECRET", origin: { lat: 1, lng: 2 } }, groupId: "g" });
    const persisted = (prisma.integrationInvocation.create as jest.Mock).mock.calls[0][0].data.sanitizedInput;
    expect(persisted.query).toBe("ok");
    expect(persisted.authorization).toBe("[redacted]");
    expect(persisted.origin).toBe("[redacted]");
  });

  it("rejects organizer-policy approval from a non-organizer; executes for an organizer", async () => {
    const { svc, store } = harness(async () => ({ confirmation: "CONF-9" }));
    store.lastTool = "purchase_tickets"; store.lastRisk = "PURCHASE"; store.lastInput = { qty: 2 };
    await svc.invoke({ serverKey: "tm", toolName: "purchase_tickets", input: { qty: 2 }, groupId: "g" });
    await expect(svc.approveAndExecute("ap1", { id: "u_sam", role: "MEMBER" })).rejects.toThrow(/organizer/i);
    const ok = await svc.approveAndExecute("ap1", { id: "u_alex", role: "ORGANIZER" });
    expect(ok.status).toBe("READY");
    expect(store.receipts[0].providerConfirmation).toBe("CONF-9");
  });

  it("degrades (no execution, no crash) when no executor is configured", async () => {
    const { svc } = harness(undefined);
    const out = await svc.invoke({ serverKey: "x", toolName: "search", input: {}, groupId: "g" });
    expect(out.status).toBe("DEGRADED");
    expect(out.envelope.status).toBe("FAILED");
  });
});
