import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeyGuard, type MerchantAuthenticatedRequest } from "../merchant/api-key.guard.js";
import { AddressService } from "./address.service.js";

@Controller("merchants/shoppers/:shopperId/addresses")
@UseGuards(ApiKeyGuard)
export class MerchantAddressController {
  constructor(@Inject(AddressService) private readonly addressService: AddressService) {}

  @Get()
  list(@Param("shopperId") shopperId: string, @Req() req: Request) {
    const { merchantId } = req as MerchantAuthenticatedRequest;
    return this.addressService.listSharedWithMerchant(shopperId, merchantId);
  }
}
