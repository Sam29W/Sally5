import { createHmac, randomUUID } from "node:crypto";
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  GatewayPaymentStatus,
  PaymentGateway,
  RefundResult,
} from "../payment-gateway.js";

/**
 * In-memory gateway used by every test (per the stage's requirement that no test ever
 * talks to a real payment network). Signs webhook bodies with the same HMAC-SHA256 scheme
 * Razorpay uses, so tests exercising signature verification exercise real logic, not a
 * stub that always returns true.
 */
export class FakeGateway implements PaymentGateway {
  readonly name = "fake";
  private readonly statuses = new Map<string, GatewayPaymentStatus>();

  constructor(private readonly webhookSecret: string) {}

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const gatewayPaymentId = `fake_pay_${randomUUID()}`;
    this.statuses.set(gatewayPaymentId, "pending");
    return {
      gatewayPaymentId,
      checkoutUrl: `https://fake-gateway.test/checkout/${gatewayPaymentId}?amount=${params.amountCents}`,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = this.sign(rawBody);
    return expected === signatureHeader;
  }

  /** Test helper — produces a valid signature for a given raw body, the same way the real
   * gateway would, so e2e tests can build an authentic webhook request. */
  sign(rawBody: Buffer): string {
    return createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
  }

  async refund(gatewayPaymentId: string, _amountCents: number): Promise<RefundResult> {
    this.statuses.set(gatewayPaymentId, "refunded");
    return { gatewayRefundId: `fake_refund_${randomUUID()}` };
  }

  async fetchStatus(gatewayPaymentId: string): Promise<GatewayPaymentStatus> {
    return this.statuses.get(gatewayPaymentId) ?? "pending";
  }

  /** Test helper — simulates the gateway having captured or failed a payment, independent
   * of any webhook (used by the reconciliation-job tests). */
  setStatus(gatewayPaymentId: string, status: GatewayPaymentStatus): void {
    this.statuses.set(gatewayPaymentId, status);
  }
}
