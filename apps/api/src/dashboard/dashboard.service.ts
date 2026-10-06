import { Inject, Injectable } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { WebhookService } from "../webhook/webhook.service.js";
import { CodRiskConfigService } from "../cod-risk/cod-risk-config.service.js";
import { computeDailyMetrics, type DailyMetrics } from "./metrics.util.js";

const DEFAULT_LIST_LIMIT = 50;

@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantService) private readonly merchantService: MerchantService,
    @Inject(WebhookService) private readonly webhookService: WebhookService,
    @Inject(CodRiskConfigService) private readonly codRiskConfigService: CodRiskConfigService,
  ) {}

  async listOrders(merchantId: string, status?: OrderStatus, limit = DEFAULT_LIST_LIMIT) {
    return this.prisma.order.findMany({
      where: { merchantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listPayments(merchantId: string, limit = DEFAULT_LIST_LIMIT) {
    return this.prisma.payment.findMany({
      where: { order: { merchantId } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listCodRiskDecisions(merchantId: string, limit = DEFAULT_LIST_LIMIT) {
    return this.prisma.codRiskDecision.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  getCodRiskConfig(merchantId: string) {
    return this.codRiskConfigService.getForMerchant(merchantId);
  }

  updateCodRiskConfig(
    merchantId: string,
    partial: Parameters<CodRiskConfigService["upsertForMerchant"]>[1],
  ) {
    return this.codRiskConfigService.upsertForMerchant(merchantId, partial);
  }

  async listApiKeys(merchantId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    });
    // Never the key secret or its hash — prefix + lifecycle metadata only.
    return keys.map((k) => ({
      id: k.id,
      prefix: k.prefix,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    }));
  }

  async rotateApiKey(merchantId: string): Promise<{ apiKey: string }> {
    const apiKey = await this.merchantService.rotateApiKey(merchantId);
    return { apiKey };
  }

  listWebhooks(merchantId: string) {
    return this.webhookService.listForMerchant(merchantId);
  }

  async getShopifySyncHealth(merchantId: string) {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { merchantId } });
    if (!shop) {
      return { connected: false as const };
    }
    return {
      connected: true as const,
      shopDomain: shop.shopDomain,
      scopes: shop.scopes,
      installedAt: shop.installedAt,
      uninstalledAt: shop.uninstalledAt,
    };
  }

  /** `days` is a window ending today, IST calendar days — see metrics.util.ts for why
   * IST and not UTC. */
  async getDailyMetrics(merchantId: string, days: number): Promise<DailyMetrics[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { merchantId, createdAt: { gte: since } },
      select: { status: true, createdAt: true },
    });
    return computeDailyMetrics(orders);
  }
}
