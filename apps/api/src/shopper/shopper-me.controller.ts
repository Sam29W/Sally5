import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/guards/access-token.guard.js";
import { ShopperService } from "./shopper.service.js";

@Controller("shopper/me")
@UseGuards(AccessTokenGuard)
export class ShopperMeController {
  constructor(@Inject(ShopperService) private readonly shopperService: ShopperService) {}

  @Get("export")
  async export(@Req() req: Request) {
    const { shopperId } = req as AuthenticatedRequest;
    return this.shopperService.exportData(shopperId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request): Promise<void> {
    const { shopperId } = req as AuthenticatedRequest;
    await this.shopperService.deleteShopper(shopperId);
  }
}
