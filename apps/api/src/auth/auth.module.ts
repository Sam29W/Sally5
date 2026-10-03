import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { OtpService } from "./otp.service.js";
import { AccessTokenGuardModule } from "./access-token-guard.module.js";
import { ShopperModule } from "../shopper/shopper.module.js";
import { SMS_PROVIDER } from "../sms/sms-provider.js";
import { ConsoleSmsProvider } from "../sms/console-sms.provider.js";

@Module({
  imports: [ShopperModule, AccessTokenGuardModule],
  controllers: [AuthController],
  providers: [OtpService, { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider }],
})
export class AuthModule {}
