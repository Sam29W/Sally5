export interface CreatePaymentParams {
  orderId: string;
  amountCents: number;
  currency: string;
}

export interface CreatePaymentResult {
  gatewayPaymentId: string;
  /** Hosted checkout redirect URL. No card/UPI data ever passes through our servers —
   * the shopper completes payment on the gateway's own hosted page. */
  checkoutUrl: string;
}

export type GatewayPaymentStatus = "pending" | "captured" | "failed" | "refunded";

export interface RefundResult {
  gatewayRefundId: string;
}

export interface PaymentGateway {
  readonly name: string;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  /** Verifies a webhook's signature over the *raw* request body. Must never trust a
   * webhook payload before this returns true. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  refund(gatewayPaymentId: string, amountCents: number): Promise<RefundResult>;
  fetchStatus(gatewayPaymentId: string): Promise<GatewayPaymentStatus>;
}

export const PAYMENT_GATEWAY_REGISTRY = "PAYMENT_GATEWAY_REGISTRY";
