import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Shopper } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { PhoneCrypto } from "../crypto/phone-crypto.js";

export const CONSENT_LOGIN_PURPOSE = "login";
export const CONSENT_LOGIN_VERSION = "1";

@Injectable()
export class ShopperService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PhoneCrypto) private readonly phoneCrypto: PhoneCrypto,
  ) {}

  async findOrCreateByPhone(phone: string): Promise<Shopper> {
    const phoneHash = this.phoneCrypto.hash(phone);
    const existing = await this.prisma.shopper.findUnique({ where: { phoneHash } });
    if (existing) {
      return existing;
    }
    return this.prisma.shopper.create({
      data: {
        phoneHash,
        phoneEncrypted: this.phoneCrypto.encrypt(phone),
        consents: {
          create: { purpose: CONSENT_LOGIN_PURPOSE, version: CONSENT_LOGIN_VERSION },
        },
      },
    });
  }

  hashPhone(phone: string): string {
    return this.phoneCrypto.hash(phone);
  }

  /** Full DPDP-style export: profile (phone decrypted for the shopper's own eyes only),
   * consents, and addresses. Never includes other shoppers' or merchants' data. */
  async exportData(shopperId: string) {
    const shopper = await this.prisma.shopper.findUnique({
      where: { id: shopperId },
      include: { consents: true, addresses: true },
    });
    if (!shopper) {
      throw new NotFoundException("Shopper not found");
    }
    return {
      id: shopper.id,
      phone: this.phoneCrypto.decrypt(shopper.phoneEncrypted),
      createdAt: shopper.createdAt,
      consents: shopper.consents.map((c) => ({
        purpose: c.purpose,
        version: c.version,
        grantedAt: c.grantedAt,
      })),
      addresses: shopper.addresses.map((a) => ({
        id: a.id,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        country: a.country,
        isDefault: a.isDefault,
      })),
    };
  }

  /** DPDP erasure: cascades to consents, addresses, session families, and refresh tokens
   * via the schema's onDelete: Cascade — nothing about this shopper survives. */
  async deleteShopper(shopperId: string): Promise<void> {
    await this.prisma.shopper.delete({ where: { id: shopperId } });
  }
}
