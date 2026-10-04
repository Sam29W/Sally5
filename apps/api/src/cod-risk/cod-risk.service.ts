import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CodRiskDecision as PersistedCodRiskDecision } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { scoreCodRisk } from "./cod-risk-engine.js";
import { CodRiskConfigService } from "./cod-risk-config.service.js";
import type { CodRiskDecision, CodRiskInput } from "./cod-risk-types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CodRiskService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CodRiskConfigService) private readonly configService: CodRiskConfigService,
  ) {}

  /** Gathers real inputs for `orderId`/`addressId`, scores it, and persists the decision
   * for audit. Scoped to `merchantId` — never scores or reads another merchant's order. */
  async scoreOrder(
    merchantId: string,
    orderId: string,
    addressId: string,
  ): Promise<CodRiskDecision> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.merchantId !== merchantId) {
      throw new NotFoundException("Order not found");
    }

    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.shopperId !== order.shopperId) {
      throw new NotFoundException("Address not found for this order's shopper");
    }

    const config = await this.configService.getForMerchant(merchantId);

    let phoneHash = "";
    let isNewPhone = true;
    let recentOrderCount = 0;
    if (order.shopperId) {
      const shopper = await this.prisma.shopper.findUnique({ where: { id: order.shopperId } });
      phoneHash = shopper?.phoneHash ?? "";

      const sinceLookback = new Date(Date.now() - ONE_DAY_MS);
      const [priorOrderCount, recentCount] = await Promise.all([
        this.prisma.order.count({
          where: { shopperId: order.shopperId, id: { not: order.id } },
        }),
        this.prisma.order.count({
          where: { shopperId: order.shopperId, createdAt: { gte: sinceLookback } },
        }),
      ]);
      isNewPhone = priorOrderCount === 0;
      recentOrderCount = recentCount;
    }

    const input: CodRiskInput = {
      phoneHash,
      isNewPhone,
      orderValueCents: order.totalCents,
      pincode: address.pincode,
      addressQualityScore: address.qualityScore,
      orderHour: new Date().getHours(),
      recentOrderCount,
    };

    const decision = scoreCodRisk(input, config);

    await this.prisma.codRiskDecision.create({
      data: {
        orderId: order.id,
        merchantId,
        score: decision.score,
        band: decision.band,
        action: decision.action,
        reasons: decision.reasons,
        ruleVersion: decision.ruleVersion,
        inputs: input as unknown as object,
      },
    });

    return decision;
  }

  /** Scoped to `merchantId` via the owning order — never returns another merchant's
   * decisions. */
  async listForOrder(merchantId: string, orderId: string): Promise<PersistedCodRiskDecision[]> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.merchantId !== merchantId) {
      throw new NotFoundException("Order not found");
    }
    return this.prisma.codRiskDecision.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
  }

  async recordOutcome(merchantId: string, orderId: string, delivered: boolean): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.merchantId !== merchantId) {
      throw new NotFoundException("Order not found");
    }
    await this.prisma.codRiskOutcome.upsert({
      where: { orderId },
      create: { orderId, delivered },
      update: { delivered },
    });
  }
}
