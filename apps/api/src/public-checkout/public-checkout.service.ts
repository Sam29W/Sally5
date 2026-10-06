import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { PaymentService } from "../payment/payment.service.js";
import { CodRiskService } from "../cod-risk/cod-risk.service.js";
import { OrderService } from "../order/order.service.js";
import type { PaymentMethod } from "../payment/payment-routing.js";

/**
 * The checkout web app runs in the shopper's browser and can never hold a merchant's
 * secret API key — so this surface is keyed by the order/cart id itself as a bearer
 * capability, the same pattern Razorpay's own `order_id` already uses client-side (Stage
 * 4's RazorpayGateway.createPayment literally hands that id to the browser on purpose).
 * IDs are UUIDv4 (effectively unguessable) and every response is scoped to exactly the
 * one order/cart named in the URL — never a list, never another merchant's or shopper's
 * data.
 */
@Injectable()
export class PublicCheckoutService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(CodRiskService) private readonly codRiskService: CodRiskService,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  async getCart(cartId: string) {
    const cart = await this.prisma.cartSession.findUnique({ where: { id: cartId } });
    if (!cart) throw new NotFoundException("Cart not found");
    return {
      id: cart.id,
      items: cart.items,
      subtotalCents: cart.subtotalCents,
      discountCents: cart.discountCents,
      shippingCents: cart.shippingCents,
      taxCents: cart.taxCents,
      totalCents: cart.totalCents,
    };
  }

  async getOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    return { id: order.id, status: order.status, totalCents: order.totalCents };
  }

  private async requireOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  /** See OrderService.claimForShopper — links the OTP-verified shopper to an order that
   * was created anonymously by the merchant before checkout began. */
  async claimOrder(orderId: string, shopperId: string) {
    const order = await this.orderService.claimForShopper(orderId, shopperId);
    return { id: order.id, status: order.status, totalCents: order.totalCents };
  }

  async createPayment(orderId: string, method: PaymentMethod) {
    const order = await this.requireOrder(orderId);
    return this.paymentService.createPayment(order.merchantId, orderId, method);
  }

  async scoreCodRisk(orderId: string, addressId: string) {
    const order = await this.requireOrder(orderId);
    const decision = await this.codRiskService.scoreOrder(order.merchantId, orderId, addressId);
    return {
      band: decision.band,
      action: decision.action,
      reasons: decision.reasons,
    };
  }

  /** Only allows the one client-safe transition: confirming COD after a risk score was
   * already computed. `paid` is only ever set by a verified payment webhook; `cancelled`
   * and everything else stay out of this public surface entirely. */
  async confirmCod(orderId: string) {
    const order = await this.requireOrder(orderId);
    // COD never goes through a gateway, so nothing else moves the order out of `created`
    // first — do it here, then the actual confirmation, so the caller only has one action
    // to take ("confirm COD") regardless of where the order currently sits.
    if (order.status === OrderStatus.created) {
      await this.orderService.transition(order.merchantId, orderId, OrderStatus.payment_pending);
    }
    return this.orderService.transition(order.merchantId, orderId, OrderStatus.cod_confirmed);
  }
}
