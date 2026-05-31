import { Logger } from "@nestjs/common";
import { EscrowHold, PaymentProvider } from "./payment.provider";

// Working mock: generates refs and logs transitions so split/escrow can be demoed end-to-end
// without Stripe. In-memory state is sufficient for the slice (truth lives in the Split table).
export class MockPaymentProvider implements PaymentProvider {
  private readonly log = new Logger("MockPay");
  private seq = 0;

  async hold(totalCents: number, memo: string): Promise<EscrowHold> {
    const ref = `mock_pi_${++this.seq}`;
    this.log.log(`[escrow] HOLD ${totalCents}c "${memo}" → ${ref}`);
    return { externalRef: ref, state: "HELD" };
  }
  async capture(externalRef: string) {
    this.log.log(`[escrow] CAPTURE ${externalRef}`);
    return { externalRef, state: "CAPTURED" as const };
  }
  async refund(externalRef: string) {
    this.log.log(`[escrow] REFUND ${externalRef}`);
    return { externalRef, state: "REFUNDED" as const };
  }
}
