import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { CoreModule } from "./core.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { MerchantModule } from "./merchant/merchant.module.js";
import { WebhookModule } from "./webhook/webhook.module.js";
import { AddressModule } from "./address/address.module.js";

@Module({
  imports: [
    CoreModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    MerchantModule,
    WebhookModule,
    AddressModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
