import { Module } from "@nestjs/common";
import { ShopifyController } from "./shopify.controller.js";
import { ShopifyOAuthService } from "./shopify-oauth.service.js";
import { ShopifyWebhookService } from "./shopify-webhook.service.js";
import { shopifyTokenCryptoProvider } from "./shopify-token-crypto.provider.js";
import { MerchantModule } from "../merchant/merchant.module.js";

@Module({
  imports: [MerchantModule],
  controllers: [ShopifyController],
  providers: [ShopifyOAuthService, ShopifyWebhookService, shopifyTokenCryptoProvider],
})
export class ShopifyModule {}
