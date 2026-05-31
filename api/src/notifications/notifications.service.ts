import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { COMMS, PUSH, Comms, Push } from "./comms.types";

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(COMMS) private readonly comms: Comms,
    @Inject(PUSH) private readonly push: Push,
  ) {}

  sendSms(to: string, body: string) {
    return this.comms.sendSms(to, body);
  }

  // Push to all of a user's devices. Strips private fields by contract: callers pass only the
  // recipient-safe payload (surprise/budget never reach here — enforced upstream in plan.service).
  async pushToUser(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }) {
    const devices = await this.prisma.device.findMany({ where: { userId } });
    await Promise.all(devices.map((d) => this.push.send(d.apnsToken, payload)));
  }
}
