import { McpConnectionService } from "../src/integrations/mcp/mcp-connection.service";
import { connectorRegistryEntry, isConnectable } from "../src/integrations/mcp/connector-registry";
import { existsSync } from "fs";

// In-app connector management: the registry resolves a (mock) MCP server per catalog key, and the
// connection service discovers + persists tools with risk/approval, upserts on re-connect, and
// disconnects cleanly. The real stdio transport is proven live against the bundled mock server in
// the e2e/live path (ESM SDK can't be dynamically imported under ts-jest); here we test the logic
// with an injected fake executor + a stateful prisma fake.

describe("ConnectorRegistry", () => {
  it("maps the six mock connectors to a stdio transport with the bundled server script", () => {
    for (const key of ["google-calendar", "google-maps", "resy", "ticketmaster", "flights", "lodging"]) {
      const reg = connectorRegistryEntry(key);
      expect(reg).not.toBeNull();
      expect(reg!.serverKey).toBe(`mock-${key}`);
      expect(reg!.transport.transport).toBe("stdio");
      expect(reg!.transport.args[1]).toBe(key);
      expect(existsSync(reg!.transport.args[0])).toBe(true); // resolved server.mjs exists
    }
  });

  it("treats weatherkit and unknown keys as not connectable", () => {
    expect(connectorRegistryEntry("weatherkit")).toBeNull();
    expect(connectorRegistryEntry("nope")).toBeNull();
    expect(isConnectable("resy")).toBe(true);
    expect(isConnectable("weatherkit")).toBe(false);
  });
});

// Minimal stateful prisma fake for ConnectorConnection + ConnectorTool.
function prismaFake() {
  const db: { conns: any[]; seq: number } = { conns: [], seq: 0 };
  const shape = (c: any) => ({ ...c, tools: c.tools ?? [] });
  return {
    connectorConnection: {
      findFirst: jest.fn(async ({ where }: any) =>
        db.conns.find((c) => c.catalogKey === where.catalogKey && (c.groupId ?? null) === (where.groupId ?? null)) ?? null),
      findMany: jest.fn(async ({ where }: any) => db.conns.filter((c) => c.groupId === where.groupId)),
      create: jest.fn(async ({ data }: any) => {
        const c = shape({ id: `c${++db.seq}`, ...data, tools: (data.tools?.create ?? []).map((t: any, i: number) => ({ id: `t${i}`, ...t })) });
        db.conns.push(c);
        return c;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = db.conns.find((x) => x.id === where.id);
        Object.assign(c, data, { tools: (data.tools?.create ?? []).map((t: any, i: number) => ({ id: `t${i}`, ...t })) });
        return c;
      }),
      delete: jest.fn(async ({ where }: any) => { db.conns = db.conns.filter((c) => c.id !== where.id); }),
    },
    connectorTool: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    _db: db,
  };
}

const fakeExecutor = (tools: any[]) => ({
  register: jest.fn(),
  evict: jest.fn(),
  listTools: jest.fn(async () => tools),
}) as any;

describe("McpConnectionService", () => {
  const resyTools = [
    { name: "search_restaurants", inputSchema: { type: "object" } },
    { name: "book_reservation", inputSchema: { type: "object" } },
  ];

  it("discovers tools, classifies risk + approval policy, marks health ok", async () => {
    const prisma = prismaFake();
    const svc = new McpConnectionService(prisma as any, fakeExecutor(resyTools));
    const out = await svc.connectAndDiscover({ catalogKey: "resy", serverKey: "mock-resy", transport: {}, groupId: "g_crew" });
    expect(out.health).toBe("ok");
    expect(out.coverage).toBe("available");
    const byName = Object.fromEntries(out.tools.map((t: any) => [t.name, t]));
    expect(byName["search_restaurants"]).toMatchObject({ risk: "READ", approvalPolicy: "none" });
    expect(byName["book_reservation"]).toMatchObject({ risk: "HOLD", approvalPolicy: "member" });
  });

  it("upserts on re-connect (no duplicate rows; tools replaced)", async () => {
    const prisma = prismaFake();
    const svc = new McpConnectionService(prisma as any, fakeExecutor(resyTools));
    await svc.connectAndDiscover({ catalogKey: "resy", serverKey: "mock-resy", transport: {}, groupId: "g_crew" });
    await svc.connectAndDiscover({ catalogKey: "resy", serverKey: "mock-resy", transport: {}, groupId: "g_crew" });
    expect(prisma._db.conns.length).toBe(1);
    expect(prisma.connectorConnection.update).toHaveBeenCalled();
    expect(prisma.connectorTool.deleteMany).toHaveBeenCalled();
  });

  it("reports degraded coverage + down health when discovery fails", async () => {
    const prisma = prismaFake();
    const exec = { register: jest.fn(), listTools: jest.fn(async () => { throw new Error("spawn failed"); }) } as any;
    const svc = new McpConnectionService(prisma as any, exec);
    const out = await svc.connectAndDiscover({ catalogKey: "resy", serverKey: "mock-resy", transport: {}, groupId: "g_crew" });
    expect(out.health).toBe("down");
    expect(out.coverage).toBe("degraded");
  });

  it("disconnect removes the group's connection and is idempotent", async () => {
    const prisma = prismaFake();
    const svc = new McpConnectionService(prisma as any, fakeExecutor(resyTools));
    await svc.connectAndDiscover({ catalogKey: "resy", serverKey: "mock-resy", transport: {}, groupId: "g_crew" });
    expect((await svc.disconnect("resy", "g_crew")).disconnected).toBe(true);
    expect(prisma._db.conns.length).toBe(0);
    expect((await svc.disconnect("resy", "g_crew")).disconnected).toBe(false);
  });

  it("lists per-group connection state for connected connectors", async () => {
    const prisma = prismaFake();
    const svc = new McpConnectionService(prisma as any, fakeExecutor(resyTools));
    await svc.connectAndDiscover({ catalogKey: "resy", serverKey: "mock-resy", transport: {}, groupId: "g_crew" });
    const list = await svc.listForGroup("g_crew");
    expect(list).toEqual([{ catalogKey: "resy", connected: true, health: "ok", coverage: "available", toolCount: 2 }]);
  });
});
