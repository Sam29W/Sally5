import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { CoreModule } from "./core.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { MerchantModule } from "./merchant/merchant.module.js";
import { WebhookModule } from "./webhook/webhook.module.js";
import { AddressModule } from "./address/address.module.js";
import { KafkaModule } from "./kafka/kafka.module.js";
import { CartModule } from "./cart/cart.module.js";
import { OrderModule } from "./order/order.module.js";
import { OutboxModule } from "./outbox/outbox.module.js";
import { PaymentModule } from "./payment/payment.module.js";
import { CodRiskModule } from "./cod-risk/cod-risk.module.js";
import { PublicCheckoutModule } from "./public-checkout/public-checkout.module.js";
import { ShopifyModule } from "./shopify/shopify.module.js";

@Module({
  imports: [
    CoreModule,
    PrismaModule,
    RedisModule,
    KafkaModule,
    AuthModule,
    MerchantModule,
    WebhookModule,
    AddressModule,
    CartModule,
    OrderModule,
    OutboxModule,
    PaymentModule,
    CodRiskModule,
    PublicCheckoutModule,
    ShopifyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
