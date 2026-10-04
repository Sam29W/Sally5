import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Address } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { scoreAddressQuality } from "./address-quality.js";
import { isValidIndianPincode, normalizePincode } from "./pincode.util.js";
import type { AddressInputDto } from "./dto/address-input.dto.js";

@Injectable()
export class AddressService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private buildData(input: AddressInputDto) {
    const pincode = normalizePincode(input.pincode);
    if (!isValidIndianPincode(pincode)) {
      throw new BadRequestException("pincode must be a valid 6-digit Indian PIN code");
    }
    return {
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state,
      pincode,
      country: input.country ?? "IN",
      qualityScore: scoreAddressQuality({ ...input, pincode }),
    };
  }

  async create(shopperId: string, input: AddressInputDto): Promise<Address> {
    const data = this.buildData(input);
    const existingCount = await this.prisma.address.count({ where: { shopperId } });
    return this.prisma.address.create({
      data: { ...data, shopperId, isDefault: existingCount === 0 },
    });
  }

  /** Scoped to `shopperId` — never returns another shopper's addresses. */
  async listForShopper(shopperId: string): Promise<Address[]> {
    return this.prisma.address.findMany({ where: { shopperId }, orderBy: { createdAt: "asc" } });
  }

  async updateForShopper(
    shopperId: string,
    addressId: string,
    input: AddressInputDto,
  ): Promise<Address> {
    await this.assertOwnership(shopperId, addressId);
    const data = this.buildData(input);
    return this.prisma.address.update({ where: { id: addressId }, data });
  }

  async deleteForShopper(shopperId: string, addressId: string): Promise<void> {
    const result = await this.prisma.address.deleteMany({
      where: { id: addressId, shopperId },
    });
    if (result.count === 0) {
      throw new NotFoundException("Address not found");
    }
  }

  async setDefaultForShopper(shopperId: string, addressId: string): Promise<Address> {
    await this.assertOwnership(shopperId, addressId);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.address.updateMany({ where: { shopperId }, data: { isDefault: false } }),
      this.prisma.address.update({ where: { id: addressId }, data: { isDefault: true } }),
    ]);
    return updated;
  }

  /** Records shopper consent for `merchantId` to see/reuse `addressId`. */
  async shareWithMerchant(shopperId: string, addressId: string, merchantId: string): Promise<void> {
    await this.assertOwnership(shopperId, addressId);
    await this.prisma.addressShare.upsert({
      where: { addressId_merchantId: { addressId, merchantId } },
      create: { addressId, merchantId },
      update: {},
    });
  }

  private async assertOwnership(shopperId: string, addressId: string): Promise<void> {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.shopperId !== shopperId) {
      throw new NotFoundException("Address not found");
    }
  }
}
