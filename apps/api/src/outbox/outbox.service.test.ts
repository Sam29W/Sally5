import { randomUUID } from "node:crypto";
import { Kafka } from "kafkajs";
import { loadConfig } from "@app/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { CartService } from "../cart/cart.service.js";
import { OrderService } from "../order/order.service.js";
import { ORDER_EVENTS_TOPIC, OutboxService } from "./outbox.service.js";

const config = loadConfig();
const prisma = new PrismaService();
const merchantService = new MerchantService(prisma);
const cartService = new CartService(prisma);
const orderService = new OrderService(prisma);

const kafka = new Kafka({ clientId: "outbox-test", brokers: config.KAFKA_BROKERS.split(",") });
let producer: ReturnType<typeof kafka.producer>;
let outboxService: OutboxService;

let merchantId: string;
let cartId: string;

beforeEach(async () => {
  await prisma.$connect();
  producer = kafka.producer();
  await producer.connect();
  outboxService = new OutboxService(prisma, producer);

  const { merchant } = await merchantService.createMerchantWithApiKey(
    `Outbox Test ${randomUUID()}`,
  );
  merchantId = merchant.id;
  const cart = await cartService.create(merchantId, [
    { sku: "A", name: "Widget", quantity: 1, unitPriceCents: 500 },
  ]);
  cartId = cart.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OutboxService — crash-between-write-and-publish durability", () => {
  it("an event written but never published survives and is still deliverable later", async () => {
    // Simulates the process crashing right after the DB transaction commits, before the
    // publish step ever ran — createIdempotent only writes to Postgres, it never touches
    // Kafka, so this is exactly that window.
    const order = await orderService.createIdempotent(merchantId, cartId, randomUUID());

    const beforePublish = await prisma.outboxEvent.findMany({ where: { orderId: order.id } });
    expect(beforePublish).toHaveLength(1);
    expect(beforePublish[0]?.publishedAt).toBeNull();

    // "Restart": a fresh publish pass finds the still-unpublished row and delivers it —
    // no event was lost, even though nothing published it until now.
    const published = await outboxService.publishPending();
    expect(published).toBeGreaterThanOrEqual(1);

    const afterPublish = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: beforePublish[0]!.id },
    });
    expect(afterPublish.publishedAt).not.toBeNull();
  });

  it("publishPending is safe to call repeatedly — already-published events aren't resent", async () => {
    const order = await orderService.createIdempotent(merchantId, cartId, randomUUID());
    const firstPass = await outboxService.publishPending();
    expect(firstPass).toBe(1);

    const secondPass = await outboxService.publishPending();
    expect(secondPass).toBe(0);

    const events = await prisma.outboxEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
  });

  it("actually delivers the event to the real Kafka topic with the expected shape", async () => {
    const order = await orderService.createIdempotent(merchantId, cartId, randomUUID());

    const consumer = kafka.consumer({ groupId: `outbox-test-${randomUUID()}` });
    await consumer.connect();
    await consumer.subscribe({ topic: ORDER_EVENTS_TOPIC, fromBeginning: true });

    // Wait for the consumer to actually finish joining the group and get partitions
    // assigned before publishing — otherwise there's a race where the message is
    // produced before the consumer is subscribed and ready, and it's never delivered.
    const groupJoined = new Promise<void>((resolve) => {
      consumer.on(consumer.events.GROUP_JOIN, () => resolve());
    });
    const received = new Promise<Record<string, unknown>>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          const value = JSON.parse(message.value?.toString() ?? "{}") as Record<string, unknown>;
          if (value.orderId === order.id) resolve(value);
        },
      });
    });
    await groupJoined;

    await outboxService.publishPending();
    const message = await received;
    expect(message.eventType).toBe("order.created");
    expect(message.orderId).toBe(order.id);

    await consumer.disconnect();
  }, 20000);
});
