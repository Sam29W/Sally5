import { Module } from "@nestjs/common";
import { AddressController } from "./address.controller.js";
import { MerchantAddressController } from "./merchant-address.controller.js";
import { AddressService } from "./address.service.js";
import { AccessTokenGuardModule } from "../auth/access-token-guard.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";

@Module({
  imports: [AccessTokenGuardModule, MerchantModule],
  controllers: [AddressController, MerchantAddressController],
  providers: [AddressService],
})
export class AddressModule {}
