import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "../merchant/api-key.guard.js";
import { CartService } from "./cart.service.js";
import { CreateCartDto } from "./dto/create-cart.dto.js";

@Controller("carts")
@UseGuards(ApiKeyGuard)
export class CartController {
  constructor(@Inject(CartService) private readonly cartService: CartService) {}

  @Post()
  create(@Body() dto: CreateCartDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.cartService.create(merchantId, dto.items, dto.couponCode, dto.shopperId);
  }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.cartService.getForMerchant(merchantId, id);
  }
}
