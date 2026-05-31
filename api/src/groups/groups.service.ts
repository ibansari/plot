import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { MemberRole, PermissionScope } from "@plot/db";

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  // Groups the user belongs to, with the data the Chats list renders.
  async myGroups(userId: string) {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: { include: { user: true, contact: true } },
            threads: { orderBy: { createdAt: "asc" }, take: 1 },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    const out: Array<{
      id: string;
      name: string;
      threadId?: string;
      memberNames: string[];
      lastMessage?: { body: string; isAgent: boolean };
      activePlan?: { id: string; title: string; state: string };
      needsYou: boolean;
    }> = [];
    for (const m of memberships) {
      const g = m.group;
      const thread = g.threads[0];
      const lastMsg = thread
        ? await this.prisma.message.findFirst({
            where: { threadId: thread.id },
            orderBy: { createdAt: "desc" },
            include: { author: true },
          })
        : null;
      const activePlan = await this.prisma.plan.findFirst({
        where: { groupId: g.id, state: { in: ["PROPOSED", "VOTING", "LOCKED", "BOOKED"] } },
        orderBy: { updatedAt: "desc" },
      });
      // "needs you": a plan is open for votes and this user hasn't voted yet
      let needsYou = false;
      if (activePlan?.state === "VOTING") {
        const voted = await this.prisma.vote.count({ where: { planId: activePlan.id, userId } });
        needsYou = voted === 0;
      }
      out.push({
        id: g.id,
        name: g.name,
        threadId: thread?.id,
        memberNames: g.members.map((mm) => mm.user?.displayName ?? mm.contact?.displayName ?? "?"),
        lastMessage: lastMsg
          ? { body: lastMsg.body, isAgent: lastMsg.kind === "AGENT" || lastMsg.kind === "DECISION_CARD" }
          : undefined,
        activePlan: activePlan ? { id: activePlan.id, title: activePlan.title, state: activePlan.state } : undefined,
        needsYou,
      });
    }
    return out;
  }

  async createGroup(userId: string, name: string) {
    if (!name?.trim()) throw new BadRequestException("group name required");
    const group = await this.prisma.group.create({
      data: {
        name: name.trim(),
        members: { create: { userId, role: MemberRole.ORGANIZER } },
        threads: { create: { title: name.trim() } },
      },
      include: { threads: true, members: { include: { user: true, contact: true } } },
    });
    // grant the organizer the scopes the agent needs in this group
    for (const scope of [
      PermissionScope.CALENDAR_BUSYFREE,
      PermissionScope.PLACES_SEARCH,
      PermissionScope.SEND_NONUSER_INVITE,
    ]) {
      await this.prisma.permission.upsert({
        where: { userId_groupId_scope: { userId, groupId: group.id, scope } },
        update: { granted: true },
        create: { userId, groupId: group.id, scope, granted: true },
      });
    }
    return this.getGroup(group.id);
  }

  // Add a member: a real user (by phone — created if new) or a non-user contact reached over SMS.
  async addMember(groupId: string, input: { phone: string; displayName?: string; asNonUser?: boolean }) {
    const phone = input.phone?.trim();
    if (!phone) throw new BadRequestException("phone required");
    await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } });

    if (input.asNonUser) {
      const contact = await this.prisma.contact.upsert({
        where: { phone },
        update: { displayName: input.displayName ?? undefined },
        create: { phone, displayName: input.displayName ?? phone },
      });
      await this.prisma.groupMember.upsert({
        where: { groupId_contactId: { groupId, contactId: contact.id } },
        update: {},
        create: { groupId, contactId: contact.id, role: MemberRole.MEMBER },
      });
    } else {
      let user = await this.prisma.user.findUnique({ where: { phone } });
      if (!user) {
        user = await this.prisma.user.create({ data: { phone, displayName: input.displayName ?? phone } });
        await this.prisma.moneyAccount.create({ data: { userId: user.id, provider: "mock" } });
      }
      await this.prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: user.id } },
        update: {},
        create: { groupId, userId: user.id, role: MemberRole.MEMBER },
      });
      for (const scope of [PermissionScope.CALENDAR_BUSYFREE, PermissionScope.PLACES_SEARCH, PermissionScope.SEND_NONUSER_INVITE]) {
        await this.prisma.permission.upsert({
          where: { userId_groupId_scope: { userId: user.id, groupId, scope } },
          update: { granted: true },
          create: { userId: user.id, groupId, scope, granted: true },
        });
      }
    }
    return this.getGroup(groupId);
  }

  async getGroup(groupId: string) {
    const g = await this.prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        members: { include: { user: true, contact: true } },
        threads: { orderBy: { createdAt: "asc" }, take: 1 },
      },
    });
    return {
      id: g.id,
      name: g.name,
      threadId: g.threads[0]?.id,
      members: g.members.map((m) => ({
        name: m.user?.displayName ?? m.contact?.displayName ?? "?",
        role: m.role,
        isNonUser: !!m.contactId,
        phone: m.user?.phone ?? m.contact?.phone ?? undefined,
        // the Members sheet surfaces what Plot knows (Sam's dietary flag, etc.) — transparency (§A7)
        constraints: (m.constraints as unknown[] | null) ?? [],
      })),
    };
  }

  // Append a constraint to a member's memory, de-duplicating by text. Temporary constraints carry
  // an expiry; the agent's active_constraints filter forgets them once past (§A7).
  async rememberConstraint(
    groupId: string,
    b: { userId?: string; contactId?: string; text: string; kind: string; expiresAt?: string },
  ) {
    const member = await this.prisma.groupMember.findFirstOrThrow({
      where: { groupId, ...(b.userId ? { userId: b.userId } : { contactId: b.contactId }) },
    });
    const existing = (member.constraints as { text?: string }[] | null) ?? [];
    if (existing.some((c) => (c.text ?? "").toLowerCase() === b.text.toLowerCase())) {
      return { remembered: false, reason: "already known", constraints: existing };
    }
    const next = [...existing, { text: b.text, kind: b.kind, expiresAt: b.expiresAt }];
    await this.prisma.groupMember.update({ where: { id: member.id }, data: { constraints: next } });
    return { remembered: true, constraints: next };
  }
}
