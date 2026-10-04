import { randomUUID } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { CartService } from "../cart/cart.service.js";
import { OrderService } from "./order.service.js";

const prisma = new PrismaService();
const merchantService = new MerchantService(prisma);
const cartService = new CartService(prisma);
const orderService = new OrderService(prisma);

let merchantId: string;
let cartId: string;

beforeEach(async () => {
  await prisma.$connect();
  const { merchant } = await merchantService.createMerchantWithApiKey(
    `Test Merchant ${randomUUID()}`,
  );
  merchantId = merchant.id;
  const cart = await cartService.create(merchantId, [
    { sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 },
  ]);
  cartId = cart.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OrderService", () => {
  it("creates an order from a cart, with an order.created outbox row in the same transaction", async () => {
    const order = await orderService.createIdempotent(merchantId, cartId, randomUUID());
    expect(order.status).toBe(OrderStatus.created);
    expect(order.totalCents).toBeGreaterThan(0);

    const events = await prisma.outboxEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("order.created");
    expect(events[0]?.publishedAt).toBeNull();
  });

  it("is idempotent: the same idempotency key returns the original order, not a new one", async () => {
    const key = randomUUID();
    const first = await orderService.createIdempotent(merchantId, cartId, key);
    const second = await orderService.createIdempotent(merchantId, cartId, key);
    expect(second.id).toBe(first.id);

    const orderCount = await prisma.order.count({ where: { cartSessionId: cartId } });
    expect(orderCount).toBe(1);
  });

  it("under concurrent calls with the same never-before-seen key, exactly one order is created", async () => {
    const key = randomUUID();
    const results = await Promise.all([
      orderService.createIdempotent(merchantId, cartId, key),
      orderService.createIdempotent(merchantId, cartId, key),
      orderService.createIdempotent(merchantId, cartId, key),
      orderService.createIdempotent(merchantId, cartId, key),
      orderService.createIdempotent(merchantId, cartId, key),
    ]);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);

    const orderCount = await prisma.order.count({
      where: { merchantId, idempotencyKey: key },
    });
    expect(orderCount).toBe(1);
  });

  it("rejects creating an order from another merchant's cart", async () => {
    const { merchant: otherMerchant } = await merchantService.createMerchantWithApiKey(
      `Other Merchant ${randomUUID()}`,
    );
    await expect(
      orderService.createIdempotent(otherMerchant.id, cartId, randomUUID()),
    ).rejects.toThrow();
  });

  it("applies a legal transition and records it in the outbox", async () => {
    const order = await orderService.createIdempotent(merchantId, cartId, randomUUID());
    const updated = await orderService.transition(
      merchantId,
      order.id,
      OrderStatus.payment_pending,
    );
    expect(updated.status).toBe(OrderStatus.payment_pending);

    const events = await prisma.outboxEvent.findMany({
      where: { orderId: order.id, eventType: "order.status_changed" },
    });
    expect(events).toHaveLength(1);
  });

  it("rejects an illegal transition with a 409-mapped error, leaving status unchanged", async () => {
    const order = await orderService.createIdempotent(merchantId, cartId, randomUUID());
    await expect(
      orderService.transition(merchantId, order.id, OrderStatus.delivered),
    ).rejects.toThrow();

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe(OrderStatus.created);
  });
});
