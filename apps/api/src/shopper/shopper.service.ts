import { Inject, Injectable } from "@nestjs/common";
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
}
