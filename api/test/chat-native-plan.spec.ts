import { AuditAction, MessageKind, OptionKind, PlanState, RsvpStatus, VoteValue } from "@plot/db";
import { PlanService } from "../src/plan/plan.service";

describe("PlanService chat-native flow", () => {
  function makeService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      plan: {
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      planOption: {
        create: jest.fn(),
        delete: jest.fn(),
      },
      message: {
        create: jest.fn().mockResolvedValue({ id: "m1" }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "m1", kind: MessageKind.AGENT }),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      groupMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      rsvp: {
        upsert: jest.fn(),
      },
      bringItem: {
        createMany: jest.fn(),
      },
      ...prismaOverrides,
    } as any;
    const audit = { record: jest.fn() } as any;
    const realtime = { emitToThread: jest.fn(), emitToPlan: jest.fn() } as any;
    const inngest = { send: jest.fn() } as any;
    const recall = { remember: jest.fn().mockResolvedValue(undefined), embedThreadSummary: jest.fn() } as any;
    const booking = {} as any;
    const service = new PlanService(prisma, audit, realtime, inngest, recall, booking);

    jest.spyOn(service, "getPlan").mockImplementation(async () => ({ id: "p1" }) as any);
    (service as any).broadcastPlan = jest.fn();
    (service as any).messageDto = jest.fn(async () => ({ id: "m1" }));

    return { service, prisma, audit, realtime, inngest };
  }

  it("creates a PROPOSED draft without opening or scheduling voting", async () => {
    const { service, prisma, audit, inngest } = makeService();
    prisma.plan.create.mockResolvedValue({
      id: "p1",
      threadId: "t1",
      groupId: "g1",
      state: PlanState.DRAFT,
      options: [],
    });
    prisma.plan.findUniqueOrThrow.mockResolvedValue({ id: "p1", state: PlanState.DRAFT });
    prisma.plan.update.mockResolvedValue({ id: "p1", state: PlanState.PROPOSED });

    await service.proposeDecision({
      threadId: "t1",
      groupId: "g1",
      title: "Friday dinner",
      options: [
        { kind: OptionKind.PLACE, label: "Ananda Thai", place: "Ananda Thai" },
        { kind: OptionKind.PLACE, label: "Dishoom", place: "Dishoom" },
      ],
    });

    expect(prisma.plan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { state: PlanState.PROPOSED } }),
    );
    expect(inngest.send).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AGENT_OPENED_VOTING }),
    );
  });

  it("starts voting from PROPOSED and schedules the deadline exactly once", async () => {
    const { service, prisma, inngest } = makeService();
    prisma.plan.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: "p1",
        threadId: "t1",
        state: PlanState.PROPOSED,
        options: [{ id: "o1" }, { id: "o2" }],
      })
      .mockResolvedValueOnce({ id: "p1", state: PlanState.PROPOSED });
    prisma.plan.update
      .mockResolvedValueOnce({ id: "p1", state: PlanState.VOTING })
      .mockResolvedValueOnce({ id: "p1", state: PlanState.VOTING });

    await service.startVoting("p1");

    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(inngest.send).toHaveBeenCalledWith("plot/voting.opened", expect.any(Object));
  });

  it("only permits option edits while a plan is PROPOSED", async () => {
    const { service, prisma } = makeService();
    prisma.plan.findUniqueOrThrow.mockResolvedValue({
      id: "p1",
      state: PlanState.VOTING,
      options: [{ id: "o1" }, { id: "o2" }],
    });

    await expect(service.addOption("p1", { kind: OptionKind.ACTIVITY, label: "New option" })).rejects.toThrow(
      "Options can only be edited while the plan is a draft",
    );
    await expect(service.removeOption("p1", "o1")).rejects.toThrow(
      "Options can only be edited while the plan is a draft",
    );
  });

  it("keeps a tied plan open and schedules a short tie-break extension", async () => {
    const { service, prisma, audit, inngest } = makeService();
    prisma.plan.findUniqueOrThrow.mockResolvedValue({
      id: "p1",
      threadId: "t1",
      groupId: "g1",
      state: PlanState.VOTING,
      options: [
        { id: "o1", label: "Ananda Thai", votes: [{ value: 1, createdAt: new Date() }] },
        { id: "o2", label: "Dishoom", votes: [{ value: 1, createdAt: new Date() }] },
      ],
    });
    prisma.plan.update.mockResolvedValue({ id: "p1", state: PlanState.VOTING });

    await service.lock("p1");

    expect(prisma.plan.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: PlanState.LOCKED }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AGENT_REQUESTED_APPROVAL }),
    );
    expect(inngest.send).toHaveBeenCalledWith("plot/voting.opened", expect.any(Object));
  });

  it("explains a clear lock and creates pending RSVPs for the whole group", async () => {
    const { service, prisma } = makeService();
    prisma.plan.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: "p1",
        threadId: "t1",
        groupId: "g1",
        state: PlanState.VOTING,
        softDeadline: new Date(),
        options: [
          {
            id: "o1",
            label: "Ananda Thai",
            place: "Ananda Thai",
            startsAt: null,
            votes: [
              { value: VoteValue.UP, viaToken: "guest-token", contact: { displayName: "Jordan" } },
              { value: VoteValue.UP, viaToken: null, contact: null },
            ],
          },
          { id: "o2", label: "Dishoom", place: "Dishoom", startsAt: null, votes: [] },
        ],
      })
      .mockResolvedValueOnce({ id: "p1", state: PlanState.VOTING });
    prisma.plan.update
      .mockResolvedValueOnce({ id: "p1", state: PlanState.LOCKED })
      .mockResolvedValueOnce({ id: "p1", state: PlanState.LOCKED, lockedTime: new Date() });
    prisma.groupMember.findMany.mockResolvedValue([
      { userId: "u1", contactId: null },
      { userId: null, contactId: "c1" },
    ]);

    await service.lock("p1");

    expect(prisma.rsvp.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.rsvp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: RsvpStatus.PENDING }) }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: expect.stringContaining("Jordan voted by guest link") }),
      }),
    );
  });

  it("asks for a human pick when every leading option has a veto", async () => {
    const { service, prisma, inngest } = makeService();
    prisma.plan.findUniqueOrThrow.mockResolvedValue({
      id: "p1",
      threadId: "t1",
      groupId: "g1",
      state: PlanState.VOTING,
      options: [
        { id: "o1", label: "Ananda Thai", votes: [{ value: VoteValue.DOWN }] },
        { id: "o2", label: "Dishoom", votes: [{ value: VoteValue.DOWN }] },
      ],
    });

    await service.lock("p1");

    expect(inngest.send).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: expect.stringContaining("human pick") }),
      }),
    );
  });
});
