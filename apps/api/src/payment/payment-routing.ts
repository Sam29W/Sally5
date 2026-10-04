export type PaymentMethod = "card" | "upi" | "netbanking";

/**
 * Pure routing rule: method -> ordered candidate gateway names, most-preferred first.
 * `selectGateway` picks the first candidate actually registered (i.e. actually configured
 * with credentials) and falls back to the next one otherwise. That's the "designed for
 * failover" part the stage asks for — real failover (retrying a request against the
 * secondary gateway *after* the primary's call actually fails mid-flight) is not
 * implemented, only this upfront fallback-if-unavailable selection. The amount parameter
 * isn't used by this rule set yet; it's part of the signature because amount-based routing
 * (e.g. route high-value UPI through a different acquirer) is a realistic future rule, not
 * because this stage needs one.
 */
const ROUTING_RULES: Record<PaymentMethod, readonly string[]> = {
  card: ["razorpay", "fake"],
  upi: ["razorpay", "fake"],
  netbanking: ["razorpay", "fake"],
};

export class NoGatewayAvailableError extends Error {}

export function selectGateway(
  availableGatewayNames: ReadonlySet<string>,
  method: PaymentMethod,
  _amountCents: number,
): string {
  const candidates = ROUTING_RULES[method];
  const chosen = candidates.find((name) => availableGatewayNames.has(name));
  if (!chosen) {
    throw new NoGatewayAvailableError(`No gateway available for method "${method}"`);
  }
  return chosen;
}
