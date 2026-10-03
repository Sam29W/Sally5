import { loadConfig } from "@app/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { PhoneCrypto } from "../crypto/phone-crypto.js";
import { normalizePhone } from "../crypto/phone.util.js";
import { ShopperService } from "./shopper.service.js";

const config = loadConfig();
const prisma = new PrismaService();
const phoneCrypto = new PhoneCrypto({
  encryptionKeyHex: config.PHONE_ENCRYPTION_KEY,
  hashKey: config.PHONE_HASH_KEY,
});
const service = new ShopperService(prisma, phoneCrypto);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ShopperService", () => {
  it("never persists the plaintext phone number", async () => {
    const phone = normalizePhone(
      `+9198760${Math.floor(Math.random() * 100000)
        .toString()
        .padStart(5, "0")}`,
    );
    const shopper = await service.findOrCreateByPhone(phone);

    expect(shopper.phoneEncrypted).not.toContain(phone);
    expect(shopper.phoneEncrypted).not.toContain(phone.replace("+", ""));
    expect(phoneCrypto.decrypt(shopper.phoneEncrypted)).toBe(phone);

    const reloaded = await prisma.shopper.findUniqueOrThrow({ where: { id: shopper.id } });
    expect(reloaded.phoneEncrypted).not.toContain(phone);
    expect(reloaded.phoneEncrypted).not.toContain(phone.replace("+", ""));
  });

  it("is idempotent per phone and records a consent", async () => {
    const phone = normalizePhone(
      `+9198761${Math.floor(Math.random() * 100000)
        .toString()
        .padStart(5, "0")}`,
    );
    const first = await service.findOrCreateByPhone(phone);
    const second = await service.findOrCreateByPhone(phone);
    expect(second.id).toBe(first.id);

    const consents = await prisma.consentRecord.findMany({ where: { shopperId: first.id } });
    expect(consents).toHaveLength(1);
    expect(consents[0]?.purpose).toBe("login");
  });
});
