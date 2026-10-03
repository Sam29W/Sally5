import { Module } from "@nestjs/common";
import { MerchantController } from "./merchant.controller.js";
import { MerchantService } from "./merchant.service.js";
import { ApiKeyGuard } from "./api-key.guard.js";

@Module({
  controllers: [MerchantController],
  providers: [MerchantService, ApiKeyGuard],
  exports: [MerchantService, ApiKeyGuard],
})
export class MerchantModule {}
