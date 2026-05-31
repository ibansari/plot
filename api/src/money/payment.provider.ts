// PaymentProvider — split + escrow primitives. MockPaymentProvider fully models the money state
// machine (hold → capture/refund) so the flow is exercised today; StripeConnect is the real impl.

export interface EscrowHold {
  externalRef: string;
  state: "HELD";
}

export interface PaymentProvider {
  /** Create an escrow hold for the total (authorize, don't capture). */
  hold(totalCents: number, memo: string): Promise<EscrowHold>;
  /** Capture a previously-held amount (e.g. once the plan locks/books). */
  capture(externalRef: string): Promise<{ externalRef: string; state: "CAPTURED" }>;
  /** Release a hold (compensating action / cancellation). */
  refund(externalRef: string): Promise<{ externalRef: string; state: "REFUNDED" }>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
