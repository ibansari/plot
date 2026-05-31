// Seed "The Crew": a group of 5 — four app users + one non-user contact (reached over SMS),
// a thread with banter already in it, granted permissions, and busy/free windows so the agent's
// gather-availability node has real data. Reproducible: fixed ids, idempotent upserts.

import {
  PrismaClient,
  MemberRole,
  MessageKind,
  PermissionScope,
} from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic clock so seeds are reproducible across runs (demo "now" anchor).
// 2026-06-05 is a FRIDAY — matches the demo's "friday night" message + the agent's DEMO_NOW_ISO.
const NOW = new Date("2026-06-05T18:00:00.000Z");
const hour = (h: number) => new Date(NOW.getTime() + h * 3600_000);

async function main() {
  // ── full reset (dev seed): wipe in FK-safe order so the demo is reproducible across runs ──
  await prisma.nonUserToken.deleteMany();
  await prisma.splitShare.deleteMany();
  await prisma.split.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.bringItem.deleteMany();
  await prisma.planOption.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.message.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.availabilityWindow.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.device.deleteMany();
  await prisma.integrationConnection.deleteMany();
  await prisma.moneyAccount.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.thread.deleteMany();
  await prisma.embedding.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.user.deleteMany();
  await prisma.group.deleteMany();

  // ── users ── (The Crew, per the mockup: You/Alex is the admin/organizer)
  const users = [
    { id: "u_alex", phone: "+15550000001", displayName: "Alex", role: MemberRole.ORGANIZER },
    { id: "u_max", phone: "+15550000002", displayName: "Max", role: MemberRole.MEMBER },
    { id: "u_sam", phone: "+15550000003", displayName: "Sam", role: MemberRole.MEMBER },
    { id: "u_priya", phone: "+15550000004", displayName: "Priya", role: MemberRole.MEMBER },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { displayName: u.displayName, phone: u.phone },
      create: { id: u.id, phone: u.phone, displayName: u.displayName },
    });
    await prisma.moneyAccount.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id, provider: "mock" },
    });
    // grant the scopes the agent needs (default-deny model; here we grant)
    for (const scope of [
      PermissionScope.CALENDAR_BUSYFREE,
      PermissionScope.PLACES_SEARCH,
      PermissionScope.SEND_NONUSER_INVITE,
    ]) {
      await prisma.permission.upsert({
        where: { userId_groupId_scope: { userId: u.id, groupId: "g_crew", scope } },
        update: { granted: true },
        create: { userId: u.id, groupId: "g_crew", scope, granted: true },
      });
    }
    // mock APNs device
    await prisma.device.upsert({
      where: { userId_apnsToken: { userId: u.id, apnsToken: `mock-apns-${u.id}` } },
      update: {},
      create: { userId: u.id, apnsToken: `mock-apns-${u.id}`, platform: "ios" },
    });
  }

  // ── the non-user (Jordan): no login, votes/RSVPs/pays over SMS ──
  const jordan = await prisma.contact.upsert({
    where: { id: "c_jordan" },
    update: { displayName: "Jordan", phone: "+15550000005" },
    create: { id: "c_jordan", displayName: "Jordan", phone: "+15550000005" },
  });

  // ── group + thread ──
  const group = await prisma.group.upsert({
    where: { id: "g_crew" },
    update: { name: "The Crew" },
    create: { id: "g_crew", name: "The Crew" },
  });

  // constraint memory (§A7) — what Plot silently knows so nobody re-litigates.
  // Sam is gluten-free (permanent); Max won't do sushi; Jordan is broke *this month* (expires).
  type Constraint = { text: string; kind: string; expiresAt?: string };
  const constraints: Record<string, Constraint[]> = {
    u_sam: [{ text: "gluten-free", kind: "dietary" }],
    u_max: [{ text: "hates sushi", kind: "dislike" }],
  };

  // memberships (idempotent)
  for (const u of users) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: u.id } },
      update: { role: u.role, constraints: constraints[u.id] ?? [] },
      create: { groupId: group.id, userId: u.id, role: u.role, constraints: constraints[u.id] ?? [] },
    });
  }
  // Jordan (non-user) is broke this month — a temporary budget cap that expires end of June.
  const jordanConstraints = [
    { text: "broke this month", kind: "budget", expiresAt: new Date("2026-07-01T00:00:00.000Z").toISOString() },
  ];
  await prisma.groupMember.upsert({
    where: { groupId_contactId: { groupId: group.id, contactId: jordan.id } },
    update: { constraints: jordanConstraints },
    create: { groupId: group.id, contactId: jordan.id, role: MemberRole.MEMBER, constraints: jordanConstraints },
  });

  const thread = await prisma.thread.upsert({
    where: { id: "t_crew" },
    update: { title: "The Crew" },
    create: { id: "t_crew", groupId: group.id, title: "The Crew" },
  });

  // ── opening banter (Plot must STAY QUIET on these) ──
  await prisma.message.deleteMany({ where: { threadId: thread.id } });
  const banter = [
    { authorId: "u_max", body: "lol did everyone see the game last night" },
    { authorId: "u_priya", body: "Sam still owes me $5 from the bet 😤" },
    { authorId: "u_sam", body: "slander. I will not be taking questions" },
  ];
  // Timestamp banter in the REAL recent past so messages posted live (at the actual wall clock)
  // sort AFTER the seed — otherwise the agent would read a stale "latest message". (The NOW anchor
  // is only used for the availability window below.)
  const realNow = Date.now();
  for (let i = 0; i < banter.length; i++) {
    await prisma.message.create({
      data: {
        threadId: thread.id,
        kind: MessageKind.TEXT,
        authorId: banter[i].authorId,
        body: banter[i].body,
        createdAt: new Date(realNow - (banter.length - i + 1) * 60_000),
      },
    });
  }

  // ── busy/free windows (NO titles — §13). Friday evening 6pm–11pm is the demo window. ──
  // Maya busy 6-7, Dev busy 9-11, Priya free, Leo busy 6-6:30. Sweet spot ~7:30-9.
  await prisma.availabilityWindow.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  const busy: Array<[string, number, number]> = [
    ["u_alex", 0, 1],
    ["u_max", 3, 5],
    ["u_priya", 0, 0.5],
  ];
  for (const [userId, s, e] of busy) {
    await prisma.availabilityWindow.create({
      data: { userId, startsAt: hour(s), endsAt: hour(e), busy: true, source: "eventkit" },
    });
  }

  console.log("✦ Seeded The Crew:");
  console.log("  group   g_crew  thread t_crew");
  console.log("  users   Alex(organizer) Max Sam Priya");
  console.log("  contact Jordan (+15550000005, non-user via SMS)");
  console.log("  3 banter messages, busy/free windows, granted permissions.");
  console.log("  Demo 'now' anchor:", NOW.toISOString());
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
