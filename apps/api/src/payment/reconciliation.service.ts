import { Inject, Injectable } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import type { AppConfig } from "@app/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { CONFIG } from "../config.provider.js";
import { isLegalTransition } from "../order/order-state-machine.js";
import { GATEWAY_REGISTRY, type GatewayRegistry } from "./gateway-registry.provider.js";

/**
 * Finds payments stuck in `pending` for longer than RECONCILIATION_STALE_AFTER_MS and
 * polls the gateway directly for their real status — the safety net for a missed or
 * never-delivered webhook (gateways don't guarantee delivery; this is the fallback when
 * one never shows up).
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GATEWAY_REGISTRY) private readonly gateways: GatewayRegistry,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async reconcilePending(): Promise<number> {
    const staleBefore = new Date(Date.now() - this.config.RECONCILIATION_STALE_AFTER_MS);
    const stalePending = await this.prisma.payment.findMany({
      where: { status: "pending", createdAt: { lt: staleBefore } },
      include: { order: true },
    });

    let resolved = 0;
    for (const payment of stalePending) {
      const gateway = this.gateways.get(payment.gateway);
      if (!gateway) continue;

      const status = await gateway.fetchStatus(payment.gatewayPaymentId);
      if (status === "pending") continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status } });
        if (status === "captured" && isLegalTransition(payment.order.status, OrderStatus.paid)) {
          await tx.order.update({ where: { id: payment.orderId }, data: { status: "paid" } });
          await tx.outboxEvent.create({
            data: {
              orderId: payment.orderId,
              eventType: "order.status_changed",
              payload: { orderId: payment.orderId, from: payment.order.status, to: "paid" },
            },
          });
        }
      });
      resolved += 1;
    }
    return resolved;
  }
}
