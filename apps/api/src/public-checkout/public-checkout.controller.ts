import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/guards/access-token.guard.js";
import { PublicCheckoutService } from "./public-checkout.service.js";
import { PublicCreatePaymentDto } from "./dto/public-create-payment.dto.js";
import { PublicScoreRiskDto } from "./dto/public-score-risk.dto.js";

@Controller("public")
export class PublicCheckoutController {
  constructor(
    @Inject(PublicCheckoutService) private readonly checkoutService: PublicCheckoutService,
  ) {}

  @Get("carts/:id")
  getCart(@Param("id") id: string) {
    return this.checkoutService.getCart(id);
  }

  @Get("orders/:id")
  getOrder(@Param("id") id: string) {
    return this.checkoutService.getOrder(id);
  }

  /** Requires a shopper access token (not the merchant api key) — this is the one
   * /public/* route that isn't purely capability-based, since linking a shopper to an
   * order is exactly the action that must prove who the shopper is. */
  @Post("orders/:id/claim")
  @UseGuards(AccessTokenGuard)
  claimOrder(@Param("id") id: string, @Req() req: Request) {
    const { shopperId } = req as AuthenticatedRequest;
    return this.checkoutService.claimOrder(id, shopperId);
  }

  @Post("orders/:id/payments")
  createPayment(@Param("id") id: string, @Body() dto: PublicCreatePaymentDto) {
    return this.checkoutService.createPayment(id, dto.method);
  }

  @Post("orders/:id/cod-risk-score")
  scoreCodRisk(@Param("id") id: string, @Body() dto: PublicScoreRiskDto) {
    return this.checkoutService.scoreCodRisk(id, dto.addressId);
  }

  @Post("orders/:id/confirm-cod")
  confirmCod(@Param("id") id: string) {
    return this.checkoutService.confirmCod(id);
  }
}
