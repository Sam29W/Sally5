import { Body, Controller, Get, Inject, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OrderStatus, MerchantUserRole } from "@prisma/client";
import {
  DashboardAuthGuard,
  RequireRole,
  type DashboardAuthenticatedRequest,
} from "../dashboard-auth/guards/dashboard-auth.guard.js";
import { DashboardService } from "./dashboard.service.js";
import { UpdateCodRiskConfigDto } from "../cod-risk/dto/update-config.dto.js";
import { AuditLogService } from "../audit/audit-log.service.js";
import { auditContext } from "../audit/request-context.util.js";

function parseLimit(raw: string | undefined, fallback = 50, max = 200): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** Every route here is a human dashboard user, not a merchant's own backend — guarded by
 * DashboardAuthGuard (JWT from /dashboard-auth/login), scoped to req.merchantId the same
 * way ApiKeyGuard scopes the merchant-facing API. Role gating follows least-privilege:
 * read endpoints are open to any authenticated role; anything that changes money-adjacent
 * config or reveals API key lifecycle is owner/ops-gated. */
@Controller("dashboard")
@UseGuards(DashboardAuthGuard)
export class DashboardController {
  constructor(
    @Inject(DashboardService) private readonly dashboardService: DashboardService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  @Get("orders")
  listOrders(
    @Query("status") status: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() req: Request,
  ) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    const statusValue =
      status && (Object.values(OrderStatus) as string[]).includes(status)
        ? (status as OrderStatus)
        : undefined;
    return this.dashboardService.listOrders(merchantId, statusValue, parseLimit(limit));
  }

  @Get("payments")
  listPayments(@Query("limit") limit: string | undefined, @Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.listPayments(merchantId, parseLimit(limit));
  }

  @Get("cod-risk-decisions")
  listCodRiskDecisions(@Query("limit") limit: string | undefined, @Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.listCodRiskDecisions(merchantId, parseLimit(limit));
  }

  @Get("cod-risk-config")
  getCodRiskConfig(@Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.getCodRiskConfig(merchantId);
  }

  @Put("cod-risk-config")
  @RequireRole(MerchantUserRole.owner, MerchantUserRole.ops)
  async updateCodRiskConfig(@Body() dto: UpdateCodRiskConfigDto, @Req() req: Request) {
    const { merchantId, merchantUserId } = req as DashboardAuthenticatedRequest;
    const before = await this.dashboardService.getCodRiskConfig(merchantId);
    const after = await this.dashboardService.updateCodRiskConfig(merchantId, dto);
    await this.auditLogService.record({
      merchantId,
      actorId: merchantUserId,
      action: "cod_risk_config.update",
      resourceType: "cod_risk_config",
      oldValue: before,
      newValue: after,
      ...auditContext(req),
    });
    return after;
  }

  @Get("api-keys")
  @RequireRole(MerchantUserRole.owner)
  listApiKeys(@Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.listApiKeys(merchantId);
  }

  @Post("api-keys/rotate")
  @RequireRole(MerchantUserRole.owner)
  async rotateApiKey(@Req() req: Request) {
    const { merchantId, merchantUserId } = req as DashboardAuthenticatedRequest;
    const result = await this.dashboardService.rotateApiKey(merchantId);
    await this.auditLogService.record({
      merchantId,
      actorId: merchantUserId,
      action: "api_key.rotate",
      resourceType: "api_key",
      newValue: { prefix: result.apiKey.split(".")[0] },
      ...auditContext(req),
    });
    return result;
  }

  /** Any authenticated role can read the audit trail — knowing *that* something changed
   * (and roughly what) is useful for ops/readonly reviewers too; the sensitive parts
   * (API key secrets, passwords) are never recorded as values in the first place. */
  @Get("audit-logs")
  listAuditLogs(
    @Query("limit") limit: string | undefined,
    @Query("action") action: string | undefined,
    @Req() req: Request,
  ) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.auditLogService.listForMerchant(merchantId, { limit: parseLimit(limit), action });
  }

  @Get("webhooks")
  @RequireRole(MerchantUserRole.owner, MerchantUserRole.ops)
  listWebhooks(@Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.listWebhooks(merchantId);
  }

  @Get("shopify-status")
  getShopifyStatus(@Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.getShopifySyncHealth(merchantId);
  }

  @Get("metrics")
  getMetrics(@Query("days") days: string | undefined, @Req() req: Request) {
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.dashboardService.getDailyMetrics(merchantId, parseLimit(days, 7, 90));
  }
}
