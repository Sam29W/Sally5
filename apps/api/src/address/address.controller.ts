import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/guards/access-token.guard.js";
import { AddressService } from "./address.service.js";
import { AddressInputDto } from "./dto/address-input.dto.js";
import { ShareAddressDto } from "./dto/share-address.dto.js";

@Controller("shopper/addresses")
@UseGuards(AccessTokenGuard)
export class AddressController {
  constructor(@Inject(AddressService) private readonly addressService: AddressService) {}

  @Post()
  create(@Body() dto: AddressInputDto, @Req() req: Request) {
    const { shopperId } = req as AuthenticatedRequest;
    return this.addressService.create(shopperId, dto);
  }

  @Get()
  list(@Req() req: Request) {
    const { shopperId } = req as AuthenticatedRequest;
    return this.addressService.listForShopper(shopperId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: AddressInputDto, @Req() req: Request) {
    const { shopperId } = req as AuthenticatedRequest;
    return this.addressService.updateForShopper(shopperId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: Request): Promise<void> {
    const { shopperId } = req as AuthenticatedRequest;
    await this.addressService.deleteForShopper(shopperId, id);
  }

  @Post(":id/default")
  setDefault(@Param("id") id: string, @Req() req: Request) {
    const { shopperId } = req as AuthenticatedRequest;
    return this.addressService.setDefaultForShopper(shopperId, id);
  }

  @Post(":id/share")
  @HttpCode(HttpStatus.CREATED)
  async share(
    @Param("id") id: string,
    @Body() dto: ShareAddressDto,
    @Req() req: Request,
  ): Promise<void> {
    const { shopperId } = req as AuthenticatedRequest;
    await this.addressService.shareWithMerchant(shopperId, id, dto.merchantId);
  }
}
