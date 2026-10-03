import { Module } from "@nestjs/common";
import { CartController } from "./cart.controller.js";
import { CartService } from "./cart.service.js";
import { MerchantModule } from "../merchant/merchant.module.js";

@Module({
  imports: [MerchantModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
