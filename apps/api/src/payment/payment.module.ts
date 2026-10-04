import { Module } from "@nestjs/common";
import { PaymentController } from "./payment.controller.js";
import { WebhookController } from "./webhook.controller.js";
import { PaymentService } from "./payment.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { ReconciliationScheduler } from "./reconciliation-scheduler.service.js";
import { gatewayRegistryProvider } from "./gateway-registry.provider.js";
import { MerchantModule } from "../merchant/merchant.module.js";

@Module({
  imports: [MerchantModule],
  controllers: [PaymentController, WebhookController],
  providers: [
    PaymentService,
    ReconciliationService,
    ReconciliationScheduler,
    gatewayRegistryProvider,
  ],
  exports: [PaymentService, ReconciliationService],
})
export class PaymentModule {}
