import { Module } from "@nestjs/common";
import { DashboardAuthController } from "./dashboard-auth.controller.js";
import { DashboardAuthService } from "./dashboard-auth.service.js";
import { DashboardTokenService } from "./dashboard-token.service.js";
import { DashboardAuthGuard } from "./guards/dashboard-auth.guard.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { AuditLogModule } from "../audit/audit-log.module.js";

@Module({
  imports: [MerchantModule, AuditLogModule],
  controllers: [DashboardAuthController],
  providers: [DashboardAuthService, DashboardTokenService, DashboardAuthGuard],
  exports: [DashboardTokenService, DashboardAuthGuard],
})
export class DashboardAuthModule {}
