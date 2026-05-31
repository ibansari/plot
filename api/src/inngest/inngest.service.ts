import { Injectable, Logger } from "@nestjs/common";
import { Inngest } from "inngest";

// Single Inngest client. In dev mode (INNGEST_DEV=1) it talks to the local dev server with no keys.
@Injectable()
export class InngestService {
  private readonly log = new Logger("Inngest");
  readonly client = new Inngest({ id: "plot-api", isDev: true });

  // Graceful: if the Inngest dev server isn't up, scheduling a timer must not break the request.
  // The plan still proposes/opens voting; only the auto-lock timer is skipped (logged).
  async send(name: string, data: Record<string, unknown>) {
    try {
      return await this.client.send({ name, data });
    } catch (e) {
      this.log.warn(`Inngest unreachable — '${name}' timer not scheduled (auto-lock disabled): ${(e as Error).message}`);
      return null;
    }
  }
}
