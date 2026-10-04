import { Module } from "@nestjs/common";
import { ShopperService } from "./shopper.service.js";
import { phoneCryptoProvider } from "../crypto/phone-crypto.provider.js";

@Module({
  providers: [ShopperService, phoneCryptoProvider],
  exports: [ShopperService],
})
export class ShopperModule {}
