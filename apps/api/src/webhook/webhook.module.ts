import { Module } from "@nestjs/common";
import { WebhookController } from "./webhook.controller.js";
import { WebhookService } from "./webhook.service.js";
import { webhookSecretCryptoProvider } from "./webhook-secret-crypto.provider.js";
import { MerchantModule } from "../merchant/merchant.module.js";

@Module({
  imports: [MerchantModule],
  controllers: [WebhookController],
  providers: [WebhookService, webhookSecretCryptoProvider],
  exports: [WebhookService],
})
export class WebhookModule {}
