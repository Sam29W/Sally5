import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { OtpService } from "./otp.service.js";
import { TokenService } from "./token.service.js";
import { ShopperModule } from "../shopper/shopper.module.js";
import { SMS_PROVIDER } from "../sms/sms-provider.js";
import { ConsoleSmsProvider } from "../sms/console-sms.provider.js";

@Module({
  imports: [ShopperModule],
  controllers: [AuthController],
  providers: [OtpService, TokenService, { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider }],
})
export class AuthModule {}
