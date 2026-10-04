import { Inject, Injectable } from "@nestjs/common";
import type { Producer } from "kafkajs";
import { PrismaService } from "../prisma/prisma.service.js";
import { KAFKA_PRODUCER } from "../kafka/kafka.module.js";

export const ORDER_EVENTS_TOPIC = "checkoutkit.order-events";

@Injectable()
export class OutboxService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KAFKA_PRODUCER) private readonly producer: Producer,
  ) {}

  /**
   * Publishes every outbox row that hasn't been published yet, oldest first. Safe to call
   * repeatedly (e.g. on a timer, or after a crash/restart) — rows are only marked
   * `publishedAt` after a successful Kafka send, so nothing is ever silently dropped; at
   * worst a row is sent twice (at-least-once), which is why consumers must be idempotent
   * on `eventType` + `orderId` + `createdAt`.
   */
  async publishPending(): Promise<number> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: "asc" },
    });

    for (const event of pending) {
      await this.producer.send({
        topic: ORDER_EVENTS_TOPIC,
        messages: [
          {
            key: event.orderId,
            value: JSON.stringify({
              eventType: event.eventType,
              orderId: event.orderId,
              payload: event.payload,
              createdAt: event.createdAt.toISOString(),
            }),
          },
        ],
      });
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date() },
      });
    }

    return pending.length;
  }
}
