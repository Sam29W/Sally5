import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { MerchantUserRole } from "@prisma/client";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "../merchant/api-key.guard.js";
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
  constructor(@Inject(DashboardAuthService) private readonly authService: DashboardAuthService) {}

  /** Proof of ownership is the merchant's own API key — a secret only the merchant's own
   * systems hold — not anything a human dashboard visitor could already have. */
  @Post("bootstrap")
  @UseGuards(ApiKeyGuard)
  async bootstrap(@Body() dto: BootstrapOwnerDto, @Req() req: Request): Promise<{ status: "ok" }> {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    await this.authService.bootstrapOwner(merchantId, dto.email, dto.password);
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
    const { merchantId } = req as DashboardAuthenticatedRequest;
    return this.authService.inviteUser(merchantId, dto.email, dto.password, dto.role);
  }

  @Get("me")
  @UseGuards(DashboardAuthGuard)
  me(@Req() req: Request) {
    const { merchantUserId } = req as DashboardAuthenticatedRequest;
    return this.authService.me(merchantUserId);
  }
}
