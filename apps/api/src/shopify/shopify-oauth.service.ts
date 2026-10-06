import { randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { AesGcmCrypto } from "../crypto/aes-gcm.js";
import { SHOPIFY_TOKEN_CRYPTO } from "./shopify-token-crypto.provider.js";
import { verifyOAuthCallbackHmac } from "./shopify-hmac.util.js";

export class ShopifyNotConfiguredError extends Error {}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Real Shopify OAuth install/callback logic — HMAC verification and the authorize-URL
 * shape are exactly per Shopify's documented flow, and are unit-tested against known
 * vectors. What's untestable in this environment is the live round trip: no Shopify
 * Partner app / dev store exists here, so `exchangeCodeForToken`'s actual fetch to
 * Shopify's token endpoint has never been exercised against a real shop. See
 * docs/decisions/008-stage7-shopify.md.
 */
@Injectable()
export class ShopifyOAuthService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MerchantService) private readonly merchantService: MerchantService,
    @Inject(SHOPIFY_TOKEN_CRYPTO) private readonly tokenCrypto: AesGcmCrypto,
  ) {}

  private requireConfigured(): { apiKey: string; apiSecret: string } {
    if (!this.config.SHOPIFY_API_KEY || !this.config.SHOPIFY_API_SECRET) {
      throw new ShopifyNotConfiguredError(
        "SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not set — no Shopify Partner app is configured in this environment",
      );
    }
    return { apiKey: this.config.SHOPIFY_API_KEY, apiSecret: this.config.SHOPIFY_API_SECRET };
  }

  /** `state` is a per-install nonce the caller must persist (e.g. a signed cookie) and
   * re-check on callback — CSRF protection for the install redirect. Generating it is
   * this method's job; storing/verifying it is the controller's, same separation Stage
   * 1's OTP flow uses between generating a code and verifying one. */
  buildInstallUrl(shopDomain: string): { url: string; state: string } {
    if (!SHOP_DOMAIN_PATTERN.test(shopDomain)) {
      throw new BadRequestException("shop must be a *.myshopify.com domain");
    }
    const { apiKey } = this.requireConfigured();
    const state = randomBytes(16).toString("hex");
    const redirectUri = `${this.config.SHOPIFY_APP_URL}/shopify/callback`;
    const params = new URLSearchParams({
      client_id: apiKey,
      scope: this.config.SHOPIFY_SCOPES,
      redirect_uri: redirectUri,
      state,
    });
    return { url: `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`, state };
  }

  verifyCallback(query: Record<string, string>): boolean {
    const { apiSecret } = this.requireConfigured();
    return verifyOAuthCallbackHmac(query, apiSecret);
  }

  /**
   * Exchanges the one-time `code` for a permanent Admin API access token. Real Shopify
   * endpoint and request shape — never called by any test in this environment since
   * there's no real `code` a dev store would hand back; covered instead by
   * `shopify-hmac.util.test.ts`'s signature tests and a fake-fetch unit test for the
   * token-exchange request shape itself.
   */
  async exchangeCodeForToken(
    shopDomain: string,
    code: string,
    fetchImpl: typeof fetch = fetch,
  ): Promise<{ accessToken: string; scope: string }> {
    const { apiKey, apiSecret } = this.requireConfigured();
    const res = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
    });
    if (!res.ok) {
      throw new Error(`Shopify token exchange failed with ${res.status}`);
    }
    const body = (await res.json()) as { access_token: string; scope: string };
    return { accessToken: body.access_token, scope: body.scope };
  }

  /** Provisions a new merchant for this shop (first install) or reuses the existing one
   * (reinstall after a prior uninstall), and stores the encrypted access token. */
  async completeInstall(
    shopDomain: string,
    accessToken: string,
    scope: string,
  ): Promise<{ merchantId: string; apiKey?: string }> {
    const existing = await this.prisma.shopifyShop.findUnique({ where: { shopDomain } });
    if (existing) {
      await this.prisma.shopifyShop.update({
        where: { shopDomain },
        data: {
          accessTokenEncrypted: this.tokenCrypto.encrypt(accessToken),
          scopes: scope,
          uninstalledAt: null,
        },
      });
      return { merchantId: existing.merchantId };
    }

    const { merchant, apiKey } = await this.merchantService.createMerchantWithApiKey(
      `Shopify: ${shopDomain}`,
    );
    await this.prisma.shopifyShop.create({
      data: {
        shopDomain,
        merchantId: merchant.id,
        accessTokenEncrypted: this.tokenCrypto.encrypt(accessToken),
        scopes: scope,
      },
    });
    return { merchantId: merchant.id, apiKey };
  }

  async markUninstalled(shopDomain: string): Promise<void> {
    await this.prisma.shopifyShop.updateMany({
      where: { shopDomain },
      data: { uninstalledAt: new Date() },
    });
  }
}
