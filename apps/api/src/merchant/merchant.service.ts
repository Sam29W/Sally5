import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Merchant } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

export interface IssuedApiKey {
  fullKey: string;
  prefix: string;
}

function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Opaque API key: `<prefix>.<secret>` — the prefix is shown back to the merchant so they
 * can tell keys apart in a list; only sha256(secret) is ever stored. */
function generateApiKey(): IssuedApiKey {
  const prefix = randomBytes(6).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  return { fullKey: `${prefix}.${secret}`, prefix };
}

@Injectable()
export class MerchantService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createMerchantWithApiKey(name: string): Promise<{ merchant: Merchant; apiKey: string }> {
    const { fullKey, prefix } = generateApiKey();
    const secret = fullKey.split(".")[1]!;

    const merchant = await this.prisma.merchant.create({
      data: {
        name,
        apiKeys: { create: { prefix, keyHash: hashKey(secret) } },
      },
    });
    return { merchant, apiKey: fullKey };
  }

  async rotateApiKey(merchantId: string): Promise<string> {
    const { fullKey, prefix } = generateApiKey();
    const secret = fullKey.split(".")[1]!;

    await this.prisma.$transaction([
      this.prisma.apiKey.updateMany({
        where: { merchantId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.apiKey.create({ data: { merchantId, prefix, keyHash: hashKey(secret) } }),
    ]);
    return fullKey;
  }

  /** Returns the merchant id for a valid, non-revoked API key — null otherwise. */
  async authenticate(presentedKey: string): Promise<string | null> {
    const [, secret] = presentedKey.split(".");
    if (!secret) return null;

    const record = await this.prisma.apiKey.findUnique({ where: { keyHash: hashKey(secret) } });
    if (!record || record.revokedAt) return null;
    return record.merchantId;
  }
}
