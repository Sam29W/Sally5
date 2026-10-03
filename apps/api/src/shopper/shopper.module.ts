import { Module } from "@nestjs/common";
import { ShopperService } from "./shopper.service.js";
import { ShopperMeController } from "./shopper-me.controller.js";
import { phoneCryptoProvider } from "../crypto/phone-crypto.provider.js";
import { AccessTokenGuardModule } from "../auth/access-token-guard.module.js";

@Module({
  imports: [AccessTokenGuardModule],
  controllers: [ShopperMeController],
  providers: [ShopperService, phoneCryptoProvider],
  exports: [ShopperService],
})
export class ShopperModule {}
