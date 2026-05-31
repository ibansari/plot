import { EscrowHold, PaymentProvider } from "./payment.provider";

// Real Stripe Connect. Same interface as the mock.
// TODO: REAL CREDENTIAL — STRIPE_SECRET_KEY + STRIPE_CONNECT_CLIENT_ID; PAYMENT_PROVIDER=stripe.
// hold = PaymentIntent(capture_method:'manual'); capture = intent.capture; refund = intent.cancel/refund.
export class StripeConnectProvider implements PaymentProvider {
  async hold(_totalCents: number, _memo: string): Promise<EscrowHold> {
    throw new Error("StripeConnectProvider not configured — use PAYMENT_PROVIDER=mock");
  }
  async capture(_ref: string): Promise<{ externalRef: string; state: "CAPTURED" }> {
    throw new Error("StripeConnectProvider not configured");
  }
  async refund(_ref: string): Promise<{ externalRef: string; state: "REFUNDED" }> {
    throw new Error("StripeConnectProvider not configured");
  }
}
