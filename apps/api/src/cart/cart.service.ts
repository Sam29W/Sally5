import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CartSession } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { quoteCart, type LineItem } from "./cart-quote.js";

@Injectable()
export class CartService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    merchantId: string,
    items: LineItem[],
    couponCode?: string,
    shopperId?: string,
  ): Promise<CartSession> {
    const quote = quoteCart(items, couponCode);
    return this.prisma.cartSession.create({
      data: {
        merchantId,
        shopperId,
        items: items as unknown as object,
        couponCode,
        ...quote,
      },
    });
  }

  /** Scoped to `merchantId` — never returns another merchant's cart. */
  async getForMerchant(merchantId: string, cartId: string): Promise<CartSession> {
    const cart = await this.prisma.cartSession.findUnique({ where: { id: cartId } });
    if (!cart || cart.merchantId !== merchantId) {
      throw new NotFoundException("Cart session not found");
    }
    return cart;
  }
}
