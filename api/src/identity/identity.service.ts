import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../common/prisma.service";
import { config } from "../common/config";
import { PermissionScope } from "@plot/db";
import { AUTH_PROVIDER, AuthProvider, VerifiedIdentity } from "./auth.provider";

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
  ) {}

  // Auth-provider failures (bad code, invalid phone, Stytch 4xx) are user-facing → surface as 400
  // with the underlying message rather than a 500.
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      let msg = (e as Error).message ?? "authentication failed";
      try {
        const j = JSON.parse(msg);
        msg = j.error_message ?? msg; // unwrap Stytch's structured error
      } catch {
        /* plain message */
      }
      throw new BadRequestException(msg);
    }
  }

  startOtp(phone: string) {
    return this.guard(() => this.auth.startOtp(phone));
  }

  async verifyOtp(phone: string, code: string) {
    const identity = await this.guard(() => this.auth.verifyOtp(phone, code));
    return this.sessionFor(identity);
  }

  async verifyApple(identityToken: string, displayName?: string) {
    const identity = await this.guard(() => this.auth.verifyApple(identityToken, displayName));
    return this.sessionFor(identity);
  }

  // Resolve/create a User from a verified identity and mint a session JWT.
  private async sessionFor(identity: VerifiedIdentity) {
    let user = identity.phone
      ? await this.prisma.user.findUnique({ where: { phone: identity.phone } })
      : identity.appleSub
        ? await this.prisma.user.findUnique({ where: { appleSub: identity.appleSub } })
        : null;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: identity.phone,
          appleSub: identity.appleSub,
          displayName: identity.displayName ?? identity.phone ?? "New User",
        },
      });
    }
    const token = jwt.sign({ sub: user.id }, config.jwtSecret, {
      expiresIn: config.jwtTtlSeconds,
    });
    return {
      token,
      user: {
        id: user.id,
        displayName: user.displayName,
        phone: user.phone ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      displayName: user.displayName,
      phone: user.phone ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      defaultSpendCapCents: user.defaultSpendCapCents,
    };
  }

  // Replace this user's busy/free windows with the device's EventKit busy intervals (§13:
  // busy/free ONLY — the payload carries no titles, and we store none).
  async syncAvailability(userId: string, intervals: { startsAt: string; endsAt: string }[]) {
    await this.prisma.availabilityWindow.deleteMany({ where: { userId, source: "eventkit" } });
    if (intervals.length) {
      await this.prisma.availabilityWindow.createMany({
        data: intervals.map((i) => ({
          userId,
          startsAt: new Date(i.startsAt),
          endsAt: new Date(i.endsAt),
          busy: true,
          source: "eventkit",
        })),
      });
    }
    return { synced: intervals.length };
  }

  async registerDevice(userId: string, apnsToken: string, platform = "ios") {
    await this.prisma.device.upsert({
      where: { userId_apnsToken: { userId, apnsToken } },
      update: {},
      create: { userId, apnsToken, platform },
    });
    return { ok: true };
  }

  async getPermissions(userId: string, groupId?: string) {
    const rows = await this.prisma.permission.findMany({
      where: { userId, ...(groupId ? { groupId } : {}) },
    });
    return rows.map((r) => ({ scope: r.scope, granted: r.granted, groupId: r.groupId ?? undefined }));
  }

  async setPermission(userId: string, scope: PermissionScope, granted: boolean, groupId?: string) {
    await this.prisma.permission.upsert({
      where: { userId_groupId_scope: { userId, groupId: groupId ?? null, scope } as never },
      update: { granted },
      create: { userId, groupId: groupId ?? null, scope, granted },
    });
    return { ok: true };
  }

  async setSpendCap(userId: string, cents: number) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { defaultSpendCapCents: Math.max(0, Math.floor(cents)) },
    });
    return { defaultSpendCapCents: user.defaultSpendCapCents };
  }
}
