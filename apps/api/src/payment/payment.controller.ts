import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "../merchant/api-key.guard.js";
import { PaymentService } from "./payment.service.js";
import { CreatePaymentDto } from "./dto/create-payment.dto.js";

@Controller("payments")
@UseGuards(ApiKeyGuard)
export class PaymentController {
  constructor(@Inject(PaymentService) private readonly paymentService: PaymentService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.paymentService.createPayment(merchantId, dto.orderId, dto.method ?? "upi");
  }

  @Post(":id/refund")
  @HttpCode(HttpStatus.OK)
  refund(@Param("id") id: string, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.paymentService.refund(merchantId, id);
  }
}
