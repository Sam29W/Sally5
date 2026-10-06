import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@app/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { AesGcmCrypto } from "../crypto/aes-gcm.js";
import { ShopifyOAuthService, ShopifyNotConfiguredError } from "./shopify-oauth.service.js";

const prisma = new PrismaService();
const merchantService = new MerchantService(prisma);
const tokenCrypto = new AesGcmCrypto("0".repeat(64)); // any valid 32-byte hex key

const configured = {
  SHOPIFY_API_KEY: "test-api-key",
  SHOPIFY_API_SECRET: "test-api-secret",
  SHOPIFY_SCOPES: "read_orders,write_draft_orders",
  SHOPIFY_APP_URL: "http://localhost:3000",
} as unknown as AppConfig;

const unconfigured = {} as unknown as AppConfig;

const service = new ShopifyOAuthService(configured, prisma, merchantService, tokenCrypto);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ShopifyOAuthService.buildInstallUrl", () => {
  it("builds a well-formed install URL with a random per-call state", () => {
    const first = service.buildInstallUrl("example.myshopify.com");
    const second = service.buildInstallUrl("example.myshopify.com");
    expect(first.url).toContain("https://example.myshopify.com/admin/oauth/authorize?");
    expect(first.url).toContain("client_id=test-api-key");
    expect(first.url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fshopify%2Fcallback");
    expect(first.state).not.toBe(second.state);
  });

  it("rejects a shop domain that isn't *.myshopify.com", () => {
    expect(() => service.buildInstallUrl("not-shopify.example.com")).toThrow();
  });

  it("throws ShopifyNotConfiguredError when credentials are absent", () => {
    const unconfiguredService = new ShopifyOAuthService(
      unconfigured,
      prisma,
      merchantService,
      tokenCrypto,
    );
    expect(() => unconfiguredService.buildInstallUrl("example.myshopify.com")).toThrow(
      ShopifyNotConfiguredError,
    );
  });
});

describe("ShopifyOAuthService install/uninstall lifecycle", () => {
  it("provisions a new merchant on first install and stores an encrypted token", async () => {
    const shopDomain = `first-install-${randomUUID()}.myshopify.com`;
    const { merchantId, apiKey } = await service.completeInstall(
      shopDomain,
      "shpat_realtoken123",
      "read_orders",
    );
    expect(merchantId).toBeTruthy();
    expect(apiKey).toBeTruthy();

    const shop = await prisma.shopifyShop.findUnique({ where: { shopDomain } });
    expect(shop?.merchantId).toBe(merchantId);
    expect(shop?.accessTokenEncrypted).not.toContain("shpat_realtoken123");
  });

  it("reuses the existing merchant on reinstall rather than creating a second one", async () => {
    const shopDomain = `reinstall-${randomUUID()}.myshopify.com`;
    const install1 = await service.completeInstall(shopDomain, "token-v1", "read_orders");
    await service.markUninstalled(shopDomain);
    const install2 = await service.completeInstall(
      shopDomain,
      "token-v2",
      "read_orders,write_draft_orders",
    );

    expect(install2.merchantId).toBe(install1.merchantId);
    expect(install2.apiKey).toBeUndefined();

    const shop = await prisma.shopifyShop.findUnique({ where: { shopDomain } });
    expect(shop?.uninstalledAt).toBeNull();
    expect(shop?.scopes).toBe("read_orders,write_draft_orders");
  });

  it("marks a shop uninstalled without deleting it", async () => {
    const shopDomain = `uninstall-${randomUUID()}.myshopify.com`;
    await service.completeInstall(shopDomain, "token", "read_orders");
    await service.markUninstalled(shopDomain);

    const shop = await prisma.shopifyShop.findUnique({ where: { shopDomain } });
    expect(shop?.uninstalledAt).not.toBeNull();
  });
});

describe("ShopifyOAuthService.exchangeCodeForToken", () => {
  it("exchanges a code for a token using the real Shopify token-endpoint shape", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "shpat_abc", scope: "read_orders" }),
    });
    const result = await service.exchangeCodeForToken(
      "example.myshopify.com",
      "one-time-code",
      fakeFetch as unknown as typeof fetch,
    );
    expect(result).toEqual({ accessToken: "shpat_abc", scope: "read_orders" });
    expect(fakeFetch).toHaveBeenCalledWith(
      "https://example.myshopify.com/admin/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
