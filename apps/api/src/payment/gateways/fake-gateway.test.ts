import { describe, expect, it } from "vitest";
import { FakeGateway } from "./fake-gateway.js";

describe("FakeGateway", () => {
  const gateway = new FakeGateway("test-secret");

  it("creates a payment with a checkout URL and pending status", async () => {
    const result = await gateway.createPayment({
      orderId: "order_1",
      amountCents: 1000,
      currency: "INR",
    });
    expect(result.gatewayPaymentId).toMatch(/^fake_pay_/);
    expect(result.checkoutUrl).toContain(result.gatewayPaymentId);
    expect(await gateway.fetchStatus(result.gatewayPaymentId)).toBe("pending");
  });

  it("verifies a correctly signed webhook body", () => {
    const body = Buffer.from(JSON.stringify({ id: "evt_1", event: "payment.captured" }));
    const signature = gateway.sign(body);
    expect(gateway.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it("rejects a tampered body against an otherwise-valid signature", () => {
    const body = Buffer.from(JSON.stringify({ id: "evt_1", event: "payment.captured" }));
    const signature = gateway.sign(body);
    const tampered = Buffer.from(JSON.stringify({ id: "evt_1", event: "payment.failed" }));
    expect(gateway.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const body = Buffer.from("{}");
    expect(gateway.verifyWebhookSignature(body, undefined)).toBe(false);
  });

  it("refunds a payment", async () => {
    const { gatewayPaymentId } = await gateway.createPayment({
      orderId: "order_2",
      amountCents: 500,
      currency: "INR",
    });
    const refund = await gateway.refund(gatewayPaymentId, 500);
    expect(refund.gatewayRefundId).toMatch(/^fake_refund_/);
    expect(await gateway.fetchStatus(gatewayPaymentId)).toBe("refunded");
  });
});
