import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { OrderStatus, Prisma, type Payment } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { isLegalTransition } from "../order/order-state-machine.js";
import { GATEWAY_REGISTRY, type GatewayRegistry } from "./gateway-registry.provider.js";
import { selectGateway, type PaymentMethod } from "./payment-routing.js";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

interface WebhookPayload {
  id: string;
  event: string;
  payload: { payment: { entity: { id: string } } };
}

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GATEWAY_REGISTRY) private readonly gateways: GatewayRegistry,
  ) {}

  async createPayment(
    merchantId: string,
    orderId: string,
    method: PaymentMethod,
  ): Promise<Payment> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.merchantId !== merchantId) {
      throw new NotFoundException("Order not found");
    }
    if (order.status !== OrderStatus.created && order.status !== OrderStatus.payment_pending) {
      throw new ConflictException(`Order status ${order.status} cannot accept a new payment`);
    }

    const gatewayName = selectGateway(new Set(this.gateways.keys()), method, order.totalCents);
    const gateway = this.gateways.get(gatewayName);
    if (!gateway) {
      throw new ConflictException("No payment gateway available");
    }

    const result = await gateway.createPayment({
      orderId: order.id,
      amountCents: order.totalCents,
      currency: "INR",
    });

    return this.prisma.$transaction(async (tx) => {
      if (order.status === OrderStatus.created) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.payment_pending },
        });
      }
      return tx.payment.create({
        data: {
          orderId: order.id,
          gateway: gateway.name,
          gatewayPaymentId: result.gatewayPaymentId,
          amountCents: order.totalCents,
        },
      });
    });
  }

  /** Scoped to `merchantId` via the owning order — never returns another merchant's payment. */
  async getForMerchant(merchantId: string, paymentId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment || payment.order.merchantId !== merchantId) {
      throw new NotFoundException("Payment not found");
    }
    return payment;
  }

  async refund(merchantId: string, paymentId: string): Promise<Payment> {
    const payment = await this.getForMerchant(merchantId, paymentId);
    if (payment.status !== "captured") {
      throw new ConflictException(`Payment status ${payment.status} cannot be refunded`);
    }
    const gateway = this.gateways.get(payment.gateway);
    if (!gateway) {
      throw new ConflictException(`Gateway ${payment.gateway} is not available`);
    }

    await gateway.refund(payment.gatewayPaymentId, payment.amountCents);
    return this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: "refunded" },
    });
  }

  /**
   * Processes a gateway webhook. Verifies the signature over the *raw* body first — an
   * invalid signature never gets this far. Duplicate deliveries (same gateway + event id)
   * are a no-op, not an error: the dedup insert, the payment status update, and the
   * resulting order transition all happen in one transaction, so a webhook that crashes
   * partway through can't leave the dedup row recorded without its side effects applied
   * (which would silently swallow a retry of the *same* delivery forever).
   */
  async processWebhook(
    gatewayName: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<{ status: "processed" | "duplicate" }> {
    const gateway = this.gateways.get(gatewayName);
    if (!gateway) {
      throw new NotFoundException(`Unknown gateway "${gatewayName}"`);
    }
    if (!gateway.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const event = JSON.parse(rawBody.toString("utf8")) as WebhookPayload;
    const gatewayPaymentId = event.payload.payment.entity.id;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedWebhookEvent.create({
          data: { gateway: gatewayName, eventId: event.id },
        });

        const payment = await tx.payment.findUnique({
          where: { gatewayPaymentId },
          include: { order: true },
        });
        if (!payment) {
          // Nothing of ours to update — still a successfully processed (and now deduped)
          // delivery, e.g. a webhook for a payment this merchant never created via us.
          return { status: "processed" as const };
        }

        if (event.event === "payment.captured" && payment.status === "pending") {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "captured" } });
          if (isLegalTransition(payment.order.status, OrderStatus.paid)) {
            await tx.order.update({
              where: { id: payment.orderId },
              data: { status: OrderStatus.paid },
            });
            await tx.outboxEvent.create({
              data: {
                orderId: payment.orderId,
                eventType: "order.status_changed",
                payload: { orderId: payment.orderId, from: payment.order.status, to: "paid" },
              },
            });
          }
        } else if (event.event === "payment.failed" && payment.status === "pending") {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "failed" } });
        }

        return { status: "processed" as const };
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return { status: "duplicate" };
      }
      throw err;
    }
  }
}
