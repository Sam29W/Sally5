import { randomUUID } from "node:crypto";
import { Kafka } from "kafkajs";
import { loadConfig } from "@app/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { CartService } from "../cart/cart.service.js";
import { OrderService } from "../order/order.service.js";
import { OutboxService } from "./outbox.service.js";
import { OutboxPublisherScheduler } from "./outbox-publisher-scheduler.service.js";

const config = loadConfig();
const prisma = new PrismaService();
const merchantService = new MerchantService(prisma);
const cartService = new CartService(prisma);
const orderService = new OrderService(prisma);
const kafka = new Kafka({
  clientId: "outbox-scheduler-test",
  brokers: config.KAFKA_BROKERS.split(","),
});

let merchantId: string;

beforeEach(async () => {
  await prisma.$connect();
  const { merchant } = await merchantService.createMerchantWithApiKey(
    `Scheduler Test ${randomUUID()}`,
  );
  merchantId = merchant.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createOrders(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const cart = await cartService.create(merchantId, [
      { sku: `S${i}`, name: "Widget", quantity: 1, unitPriceCents: 100 },
    ]);
    const order = await orderService.createIdempotent(merchantId, cart.id, randomUUID());
    ids.push(order.id);
  }
  return ids;
}

describe("OutboxPublisherScheduler — survives a crash mid-batch", () => {
  it("a failure partway through a batch leaves earlier events published and later ones untouched, and the next run finishes the job", async () => {
    const producer = kafka.producer();
    await producer.connect();
    const outboxService = new OutboxService(prisma, producer);
    const scheduler = new OutboxPublisherScheduler(outboxService, config);

    // publishPending() drains ALL unpublished rows, not just this test's — clear any
    // backlog left over from other test files sharing this Postgres/Kafka instance so the
    // forced failure below lands on this test's own events, not someone else's.
    await outboxService.publishPending();

    const orderIds = await createOrders(3);

    // Simulate the process crashing partway through a batch: the 2nd Kafka send throws
    // (standing in for "the pod got OOM-killed" / "the network blipped"), after the 1st
    // has already succeeded and been marked published.
    const realSend = producer.send.bind(producer);
    let callCount = 0;
    producer.send = (async (...args: Parameters<typeof producer.send>) => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("simulated crash mid-batch");
      }
      return realSend(...args);
    }) as typeof producer.send;

    const firstRunCount = await scheduler.runOnce();
    // runOnce swallows the error — it returns 0 on failure, not a partial count, because
    // the whole publishPending() call rejects. What matters is the DB state, checked next.
    expect(firstRunCount).toBe(0);

    const afterCrash = await prisma.outboxEvent.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { createdAt: "asc" },
    });
    expect(afterCrash.filter((e) => e.publishedAt !== null)).toHaveLength(1);
    expect(afterCrash.filter((e) => e.publishedAt === null)).toHaveLength(2);

    // "Restart": a fresh run with the (now healthy) producer finishes the remaining ones —
    // no event was lost, and the already-published one is not touched again.
    producer.send = realSend;
    const secondRunCount = await scheduler.runOnce();
    expect(secondRunCount).toBe(2);

    const afterRecovery = await prisma.outboxEvent.findMany({
      where: { orderId: { in: orderIds } },
    });
    expect(afterRecovery.every((e) => e.publishedAt !== null)).toBe(true);

    await producer.disconnect();
  });

  it("start()/stop() are idempotent and don't throw when called without a timer running", () => {
    const outboxService = new OutboxService(prisma, kafka.producer());
    const scheduler = new OutboxPublisherScheduler(outboxService, config);
    expect(() => scheduler.stop()).not.toThrow();
    scheduler.start();
    scheduler.start(); // second call is a no-op, not a second timer
    scheduler.stop();
    scheduler.stop(); // second stop is also a no-op
  });

  it("onModuleInit does not start a timer when NODE_ENV=test", () => {
    const outboxService = new OutboxService(prisma, kafka.producer());
    const scheduler = new OutboxPublisherScheduler(outboxService, { ...config, NODE_ENV: "test" });
    scheduler.onModuleInit();
    // No direct way to assert "no timer" from outside; the contract is just that it must
    // not throw and must leave stop() safe to call either way.
    expect(() => scheduler.onModuleDestroy()).not.toThrow();
  });
});
