import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ShopifyOAuthService } from "./shopify-oauth.service.js";

/**
 * Handles Shopify's mandatory app webhooks. `customers/data_request`,
 * `customers/redact`, and `shop/redact` are required by every Shopify app review — we
 * have no Shopify-sourced customer PII stored anywhere (shoppers only exist via our own
 * OTP flow, keyed by phone, never by a Shopify customer id), so these are accept-and-log
 * no-ops rather than real deletion jobs. If Stage 7 ever actually syncs Shopify customer
 * records, this is exactly where a real redaction job would be wired in.
 */
@Injectable()
export class ShopifyWebhookService {
  private readonly logger = new Logger(ShopifyWebhookService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShopifyOAuthService) private readonly oauthService: ShopifyOAuthService,
  ) {}

  async handle(topic: string, shopDomain: string, _payload: unknown): Promise<void> {
    switch (topic) {
      case "app/uninstalled":
        await this.oauthService.markUninstalled(shopDomain);
        return;
      case "orders/create":
        // Real sync target: map the Shopify order payload onto a CheckoutKit cart/order
        // via ShopifySyncService. Not implemented — no live store exists in this
        // environment to validate the payload shape against.
        this.logger.log({ shopDomain, topic }, "shopify order webhook received (no-op sync)");
        return;
      case "customers/data_request":
      case "customers/redact":
      case "shop/redact":
        this.logger.log(
          { shopDomain, topic },
          "GDPR webhook acknowledged — no Shopify-sourced customer data is stored",
        );
        return;
      default:
        this.logger.warn({ shopDomain, topic }, "unhandled shopify webhook topic");
        return;
    }
  }
}
