import { loadConfig } from "@app/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { ShopperService } from "../shopper/shopper.service.js";
import { PhoneCrypto } from "../crypto/phone-crypto.js";
import { normalizePhone } from "../crypto/phone.util.js";
import { RefreshTokenInvalidError, RefreshTokenReuseError, TokenService } from "./token.service.js";

const config = loadConfig();
const prisma = new PrismaService();
const phoneCrypto = new PhoneCrypto({
  encryptionKeyHex: config.PHONE_ENCRYPTION_KEY,
  hashKey: config.PHONE_HASH_KEY,
});
const shopperService = new ShopperService(prisma, phoneCrypto);
const tokenService = new TokenService(config, prisma);

let shopperId: string;

beforeEach(async () => {
  await prisma.$connect();
  const phone = normalizePhone(
    `+9198765${Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0")}`,
  );
  const shopper = await shopperService.findOrCreateByPhone(phone);
  shopperId = shopper.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TokenService", () => {
  it("issues a valid access token and a working refresh token", async () => {
    const pair = await tokenService.issueNewSession(shopperId);
    expect(tokenService.verifyAccessToken(pair.accessToken).shopperId).toBe(shopperId);

    const rotated = await tokenService.rotate(pair.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(pair.refreshToken);
  });

  it("rejects a tampered refresh token", async () => {
    const pair = await tokenService.issueNewSession(shopperId);
    const tampered = pair.refreshToken.slice(0, -1) + (pair.refreshToken.endsWith("a") ? "b" : "a");
    await expect(tokenService.rotate(tampered)).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it("detects refresh-token reuse and revokes the whole session family", async () => {
    const pair = await tokenService.issueNewSession(shopperId);
    const rotatedOnce = await tokenService.rotate(pair.refreshToken);

    // Reusing the already-rotated original token must be rejected and must revoke the family.
    await expect(tokenService.rotate(pair.refreshToken)).rejects.toBeInstanceOf(
      RefreshTokenReuseError,
    );

    // Because the family is now revoked, even the legitimately rotated token stops working.
    await expect(tokenService.rotate(rotatedOnce.refreshToken)).rejects.toBeInstanceOf(
      RefreshTokenReuseError,
    );
  });

  it("logout revokes the family so refresh subsequently fails", async () => {
    const pair = await tokenService.issueNewSession(shopperId);
    await tokenService.revokeFamilyByToken(pair.refreshToken);
    await expect(tokenService.rotate(pair.refreshToken)).rejects.toBeInstanceOf(
      RefreshTokenReuseError,
    );
  });
});
