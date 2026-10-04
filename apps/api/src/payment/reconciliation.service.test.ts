import { randomUUID } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@app/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { CartService } from "../cart/cart.service.js";
import { OrderService } from "../order/order.service.js";
import { FakeGateway } from "./gateways/fake-gateway.js";
import { ReconciliationService } from "./reconciliation.service.js";

const config = loadConfig();
const prisma = new PrismaService();
const merchantService = new MerchantService(prisma);
const cartService = new CartService(prisma);
const orderService = new OrderService(prisma);
const fakeGateway = new FakeGateway(config.FAKE_GATEWAY_WEBHOOK_SECRET);
const gateways = new Map([["fake", fakeGateway]]);
// Small but nonzero so it's robust to minor clock skew between this process and the DB
// server — tests sleep past this before calling reconcilePending().
const STALE_AFTER_MS = 10;
const reconciliationService = new ReconciliationService(prisma, gateways, {
  ...config,
  RECONCILIATION_STALE_AFTER_MS: STALE_AFTER_MS,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let merchantId: string;

beforeEach(async () => {
  await prisma.$connect();
  const { merchant } = await merchantService.createMerchantWithApiKey(
    `Reconciliation Test ${randomUUID()}`,
  );
  merchantId = merchant.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createPendingPayment(): Promise<{
  paymentId: string;
  gatewayPaymentId: string;
  orderId: string;
}> {
  const cart = await cartService.create(merchantId, [
    { sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 },
  ]);
  const order = await orderService.createIdempotent(merchantId, cart.id, randomUUID());
  await orderService.transition(merchantId, order.id, OrderStatus.payment_pending);
  const gw = await fakeGateway.createPayment({
    orderId: order.id,
    amountCents: 1000,
    currency: "INR",
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      gateway: "fake",
      gatewayPaymentId: gw.gatewayPaymentId,
      amountCents: 1000,
    },
  });
  return { paymentId: payment.id, gatewayPaymentId: gw.gatewayPaymentId, orderId: order.id };
}

describe("ReconciliationService", () => {
  it("leaves a payment alone if the gateway still reports it pending", async () => {
    const { paymentId } = await createPendingPayment();
    await sleep(50);
    await reconciliationService.reconcilePending();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("pending");
  });

  it("resolves a stuck pending payment once the gateway reports it captured, and moves the order to paid", async () => {
    const { paymentId, gatewayPaymentId, orderId } = await createPendingPayment();
    await sleep(50);
    fakeGateway.setStatus(gatewayPaymentId, "captured");

    const resolvedCount = await reconciliationService.reconcilePending();
    expect(resolvedCount).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("captured");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.paid);
  });

  it("resolves a stuck pending payment reported as failed, without touching the order", async () => {
    const { paymentId, gatewayPaymentId, orderId } = await createPendingPayment();
    await sleep(50);
    fakeGateway.setStatus(gatewayPaymentId, "failed");

    await reconciliationService.reconcilePending();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("failed");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.payment_pending);
  });
});
