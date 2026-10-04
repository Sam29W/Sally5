import { randomBytes } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { WebhookEndpoint } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AesGcmCrypto } from "../crypto/aes-gcm.js";
import { WEBHOOK_SECRET_CRYPTO } from "./webhook-secret-crypto.provider.js";

@Injectable()
export class WebhookService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WEBHOOK_SECRET_CRYPTO) private readonly crypto: AesGcmCrypto,
  ) {}

  async register(
    merchantId: string,
    url: string,
  ): Promise<{ endpoint: WebhookEndpoint; signingSecret: string }> {
    const signingSecret = randomBytes(32).toString("base64url");
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        merchantId,
        url,
        signingSecretEncrypted: this.crypto.encrypt(signingSecret),
      },
    });
    return { endpoint, signingSecret };
  }

  /** Scoped to `merchantId` — never returns another merchant's endpoints. */
  async listForMerchant(merchantId: string): Promise<WebhookEndpoint[]> {
    return this.prisma.webhookEndpoint.findMany({ where: { merchantId } });
  }

  /** Deleting requires the endpoint to belong to `merchantId` — this is the tenant-isolation
   * boundary: a merchant can never delete (or discover the existence of) another's endpoint. */
  async deleteForMerchant(merchantId: string, endpointId: string): Promise<void> {
    const result = await this.prisma.webhookEndpoint.deleteMany({
      where: { id: endpointId, merchantId },
    });
    if (result.count === 0) {
      throw new NotFoundException("Webhook endpoint not found");
    }
  }
}
