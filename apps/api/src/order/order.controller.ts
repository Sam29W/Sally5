import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { OrderService } from "./order.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";
import { TransitionOrderDto } from "./dto/transition-order.dto.js";

@Controller("orders")
@UseGuards(ApiKeyGuard)
export class OrderController {
  constructor(@Inject(OrderService) private readonly orderService: OrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateOrderDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    const idempotencyKey = req.header("idempotency-key");
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    return this.orderService.createIdempotent(merchantId, dto.cartSessionId, idempotencyKey);
  }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.orderService.getForMerchant(merchantId, id);
  }

  @Post(":id/transition")
  @HttpCode(HttpStatus.OK)
  transition(@Param("id") id: string, @Body() dto: TransitionOrderDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.orderService.transition(merchantId, id, dto.to);
  }
}
