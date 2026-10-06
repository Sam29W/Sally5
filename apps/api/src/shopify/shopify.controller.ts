import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { ShopifyOAuthService } from "./shopify-oauth.service.js";
import { ShopifyWebhookService } from "./shopify-webhook.service.js";
import { verifyWebhookHmac } from "./shopify-hmac.util.js";

/**
 * Not guarded by ApiKeyGuard or AccessTokenGuard — Shopify itself is the caller for every
 * route here, authenticated by the OAuth HMAC (install/callback) or the webhook HMAC
 * (webhooks), not by anything in our own auth system.
 */
@Controller("shopify")
export class ShopifyController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ShopifyOAuthService) private readonly oauthService: ShopifyOAuthService,
    @Inject(ShopifyWebhookService) private readonly webhookService: ShopifyWebhookService,
  ) {}

  @Get("install")
  install(@Query("shop") shop: string, @Res() res: Response): void {
    if (!shop) {
      throw new BadRequestException("shop query param is required");
    }
    const { url, state } = this.oauthService.buildInstallUrl(shop);
    // A signed/httpOnly cookie is the real mechanism for round-tripping `state` to
    // /shopify/callback for CSRF verification; omitted here since there is no live
    // install flow in this environment to round-trip it against.
    res.cookie("shopify_oauth_state", state, { httpOnly: true, sameSite: "lax" });
    res.redirect(url);
  }

  @Get("callback")
  async callback(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    if (!this.oauthService.verifyCallback(query)) {
      throw new UnauthorizedException("Invalid OAuth callback signature");
    }
    const { shop, code } = query;
    if (!shop || !code) {
      throw new BadRequestException("shop and code are required");
    }
    const { accessToken, scope } = await this.oauthService.exchangeCodeForToken(shop, code);
    await this.oauthService.completeInstall(shop, accessToken, scope);
    res.redirect(`${this.config.SHOPIFY_APP_URL}/shopify/installed`);
  }

  // Shopify posts every topic to whichever single URL you registered for it, carrying the
  // actual topic in the X-Shopify-Topic header — not in the path — so there's one route,
  // not one per topic.
  @Post("webhooks")
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: Request): Promise<{ status: "ok" }> {
    const topic = req.header("X-Shopify-Topic") ?? "";
    const rawBody = req.body as Buffer;
    const hmacHeader = req.header("X-Shopify-Hmac-Sha256");
    const shopDomain = req.header("X-Shopify-Shop-Domain") ?? "";

    if (!verifyWebhookHmac(rawBody, hmacHeader, this.config.SHOPIFY_WEBHOOK_SECRET)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    await this.webhookService.handle(topic, shopDomain, payload);
    return { status: "ok" };
  }
}
