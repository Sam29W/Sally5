/** Each gateway names its webhook signature header differently — Razorpay uses
 * X-Razorpay-Signature; our fake gateway (and any future ones) pick their own. */
const SIGNATURE_HEADER_BY_GATEWAY: Record<string, string> = {
  razorpay: "x-razorpay-signature",
  fake: "x-webhook-signature",
};

export function signatureHeaderNameFor(gateway: string): string {
  return SIGNATURE_HEADER_BY_GATEWAY[gateway] ?? "x-webhook-signature";
}
