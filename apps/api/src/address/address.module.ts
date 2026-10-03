import { Module } from "@nestjs/common";
import { AddressController } from "./address.controller.js";
import { AddressService } from "./address.service.js";
import { AccessTokenGuardModule } from "../auth/access-token-guard.module.js";

@Module({
  imports: [AccessTokenGuardModule],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
