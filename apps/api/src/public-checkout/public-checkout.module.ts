import { Module } from "@nestjs/common";
import { PublicCheckoutController } from "./public-checkout.controller.js";
import { PublicCheckoutService } from "./public-checkout.service.js";
import { PaymentModule } from "../payment/payment.module.js";
import { CodRiskModule } from "../cod-risk/cod-risk.module.js";
import { OrderModule } from "../order/order.module.js";
import { AccessTokenGuardModule } from "../auth/access-token-guard.module.js";

@Module({
  imports: [PaymentModule, CodRiskModule, OrderModule, AccessTokenGuardModule],
  controllers: [PublicCheckoutController],
  providers: [PublicCheckoutService],
})
export class PublicCheckoutModule {}
