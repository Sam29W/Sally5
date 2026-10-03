import {
  Body,
  Controller,
  Delete,
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
import { WebhookService } from "./webhook.service.js";
import { CreateWebhookDto } from "./dto/create-webhook.dto.js";

@Controller("webhooks")
@UseGuards(ApiKeyGuard)
export class WebhookController {
  constructor(@Inject(WebhookService) private readonly webhookService: WebhookService) {}

  @Post()
  async create(@Body() dto: CreateWebhookDto, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    const { endpoint, signingSecret } = await this.webhookService.register(merchantId, dto.url);
    return { id: endpoint.id, url: endpoint.url, signingSecret };
  }

  @Get()
  async list(@Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    const endpoints = await this.webhookService.listForMerchant(merchantId);
    return endpoints.map((e) => ({ id: e.id, url: e.url, createdAt: e.createdAt }));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: Request): Promise<void> {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    await this.webhookService.deleteForMerchant(merchantId, id);
  }
}
