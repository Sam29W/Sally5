import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { MerchantService } from "./merchant.service.js";
import { CreateMerchantDto } from "./dto/create-merchant.dto.js";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "./api-key.guard.js";
import { AdminProvisioningGuard } from "./admin-provisioning.guard.js";

@Controller("merchants")
export class MerchantController {
  constructor(@Inject(MerchantService) private readonly merchantService: MerchantService) {}

  @Post()
  @UseGuards(AdminProvisioningGuard)
  async create(@Body() dto: CreateMerchantDto): Promise<{ merchantId: string; apiKey: string }> {
    const { merchant, apiKey } = await this.merchantService.createMerchantWithApiKey(dto.name);
    return { merchantId: merchant.id, apiKey };
  }

  @Post("api-keys/rotate")
  @UseGuards(ApiKeyGuard)
  async rotate(@Req() req: Request): Promise<{ apiKey: string }> {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    const apiKey = await this.merchantService.rotateApiKey(merchantId);
    return { apiKey };
  }
}
