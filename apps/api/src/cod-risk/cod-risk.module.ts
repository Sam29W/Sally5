import { Module } from "@nestjs/common";
import { CodRiskController } from "./cod-risk.controller.js";
import { CodRiskService } from "./cod-risk.service.js";
import { CodRiskConfigService } from "./cod-risk-config.service.js";
import { MerchantModule } from "../merchant/merchant.module.js";

@Module({
  imports: [MerchantModule],
  controllers: [CodRiskController],
  providers: [CodRiskService, CodRiskConfigService],
  exports: [CodRiskService, CodRiskConfigService],
})
export class CodRiskModule {}
