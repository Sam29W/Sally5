import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "../merchant/api-key.guard.js";
import { CodRiskService } from "./cod-risk.service.js";
import { CodRiskConfigService } from "./cod-risk-config.service.js";
import { ScoreOrderDto } from "./dto/score-order.dto.js";
import { RecordOutcomeDto } from "./dto/record-outcome.dto.js";
import { UpdateCodRiskConfigDto } from "./dto/update-config.dto.js";

@Controller()
@UseGuards(ApiKeyGuard)
export class CodRiskController {
  constructor(
    @Inject(CodRiskService) private readonly codRiskService: CodRiskService,
    @Inject(CodRiskConfigService) private readonly configService: CodRiskConfigService,
  ) {}

  @Post("orders/:id/cod-risk/score")
  score(@Param("id") orderId: string, @Body() dto: ScoreOrderDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.codRiskService.scoreOrder(merchantId, orderId, dto.addressId);
  }

  @Get("orders/:id/cod-risk")
  list(@Param("id") orderId: string, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.codRiskService.listForOrder(merchantId, orderId);
  }

  @Post("orders/:id/cod-risk/outcome")
  async recordOutcome(
    @Param("id") orderId: string,
    @Body() dto: RecordOutcomeDto,
    @Req() req: Request,
  ): Promise<void> {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    await this.codRiskService.recordOutcome(merchantId, orderId, dto.delivered);
  }

  @Get("merchants/cod-risk-config")
  getConfig(@Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.configService.getForMerchant(merchantId);
  }

  @Put("merchants/cod-risk-config")
  updateConfig(@Body() dto: UpdateCodRiskConfigDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.configService.upsertForMerchant(merchantId, dto);
  }
}
