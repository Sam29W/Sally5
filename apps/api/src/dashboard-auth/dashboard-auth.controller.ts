import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { MerchantUserRole } from "@prisma/client";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "../merchant/api-key.guard.js";
import { AuditLogService } from "../audit/audit-log.service.js";
import { auditContext } from "../audit/request-context.util.js";
import { DashboardAuthService } from "./dashboard-auth.service.js";
import { BootstrapOwnerDto } from "./dto/bootstrap-owner.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { InviteUserDto } from "./dto/invite-user.dto.js";
import {
  DashboardAuthGuard,
  RequireRole,
  type DashboardAuthenticatedRequest,
} from "./guards/dashboard-auth.guard.js";

@Controller("dashboard-auth")
export class DashboardAuthController {
  constructor(
    @Inject(DashboardAuthService) private readonly authService: DashboardAuthService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  /** Proof of ownership is the merchant's own API key — a secret only the merchant's own
   * systems hold — not anything a human dashboard visitor could already have. */
  @Post("bootstrap")
  @UseGuards(ApiKeyGuard)
  async bootstrap(@Body() dto: BootstrapOwnerDto, @Req() req: Request): Promise<{ status: "ok" }> {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    await this.authService.bootstrapOwner(merchantId, dto.email, dto.password);
    await this.auditLogService.record({
      merchantId,
      actorApiKeyPrefix: (req.header("x-api-key") ?? "").split(".")[0] ?? null,
      action: "merchant_user.bootstrap_owner",
      resourceType: "merchant_user",
      newValue: { email: dto.email, role: "owner" },
      ...auditContext(req),
    });
    return { status: "ok" };
  }

  @Post("login")
  login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post("users")
  @UseGuards(DashboardAuthGuard)
  @RequireRole(MerchantUserRole.owner)
  async inviteUser(@Body() dto: InviteUserDto, @Req() req: Request) {
    const { merchantId, merchantUserId } = req as DashboardAuthenticatedRequest;
    const invited = await this.authService.inviteUser(
      merchantId,
      dto.email,
      dto.password,
      dto.role,
    );
    await this.auditLogService.record({
      merchantId,
      actorId: merchantUserId,
      action: "merchant_user.invite",
      resourceType: "merchant_user",
      resourceId: invited.id,
      newValue: { email: invited.email, role: invited.role },
      ...auditContext(req),
    });
    return invited;
  }

  @Get("me")
  @UseGuards(DashboardAuthGuard)
  me(@Req() req: Request) {
    const { merchantUserId } = req as DashboardAuthenticatedRequest;
    return this.authService.me(merchantUserId);
  }
}
