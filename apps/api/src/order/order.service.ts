import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, OrderStatus, type Order } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertLegalTransition } from "./order-state-machine.js";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

@Injectable()
export class OrderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Creates an order from a cart session, idempotent per (merchantId, idempotencyKey): a
   * retried call with the same key returns the original order rather than creating a
   * second one. The order row and its "order.created" outbox row are written in a single
   * transaction — see outbox/outbox.service.ts for why that matters.
   */
  async createIdempotent(
    merchantId: string,
    cartSessionId: string,
    idempotencyKey: string,
  ): Promise<Order> {
    const existing = await this.prisma.order.findUnique({
      where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } },
    });
    if (existing) {
      return existing;
    }

    const cart = await this.prisma.cartSession.findUnique({ where: { id: cartSessionId } });
    if (!cart || cart.merchantId !== merchantId) {
      throw new NotFoundException("Cart session not found");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            merchantId,
            cartSessionId,
            shopperId: cart.shopperId,
            totalCents: cart.totalCents,
            status: OrderStatus.created,
            idempotencyKey,
          },
        });
        await tx.outboxEvent.create({
          data: {
            orderId: order.id,
            eventType: "order.created",
            payload: { orderId: order.id, merchantId, totalCents: order.totalCents },
          },
        });
        return order;
      });
    } catch (err) {
      // Two concurrent calls with the same never-seen-before key can both pass the
      // findUnique check above and both reach this create — only one wins; the loser hits
      // the (merchantId, idempotencyKey) unique constraint. Treat that exactly like the
      // normal idempotent-replay path: return the winner's order instead of erroring.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const winner = await this.prisma.order.findUnique({
          where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /** Scoped to `merchantId` — never returns another merchant's order. */
  async getForMerchant(merchantId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.merchantId !== merchantId) {
      throw new NotFoundException("Order not found");
    }
    return order;
  }

  /** Links an authenticated shopper to an order created before they identified themselves
   * (phone-first checkout: the merchant creates the cart/order anonymously, and the shopper
   * verifies OTP mid-flow). Idempotent — reclaiming by the same shopper is a no-op; a claim
   * by a different shopper is rejected rather than silently reassigning the order. */
  async claimForShopper(orderId: string, shopperId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException("Order not found");
    }
    if (order.shopperId === shopperId) {
      return order;
    }
    if (order.shopperId) {
      throw new ConflictException("Order already claimed by a different shopper");
    }
    return this.prisma.order.update({ where: { id: orderId }, data: { shopperId } });
  }

  /** Validates the transition, then writes the new status and its outbox event
   * transactionally — same durability guarantee as createIdempotent. */
  async transition(merchantId: string, orderId: string, to: OrderStatus): Promise<Order> {
    const order = await this.getForMerchant(merchantId, orderId);

    try {
      assertLegalTransition(order.status, to);
    } catch {
      throw new ConflictException(`Cannot transition order from ${order.status} to ${to}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({ where: { id: orderId }, data: { status: to } });
      await tx.outboxEvent.create({
        data: {
          orderId: updated.id,
          eventType: "order.status_changed",
          payload: { orderId: updated.id, from: order.status, to },
        },
      });
      return updated;
    });
  }
}
