import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { DashboardAuthModule } from "../dashboard-auth/dashboard-auth.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { WebhookModule } from "../webhook/webhook.module.js";
import { CodRiskModule } from "../cod-risk/cod-risk.module.js";

@Module({
  imports: [DashboardAuthModule, MerchantModule, WebhookModule, CodRiskModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
