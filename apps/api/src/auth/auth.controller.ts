import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { SMS_PROVIDER, type SmsProvider } from "../sms/sms-provider.js";
import { ShopperService } from "../shopper/shopper.service.js";
import { normalizePhone } from "../crypto/phone.util.js";
import { OtpInvalidError, OtpLockedError, OtpRateLimitedError, OtpService } from "./otp.service.js";
import { RefreshTokenInvalidError, RefreshTokenReuseError, TokenService } from "./token.service.js";
import { RequestOtpDto } from "./dto/request-otp.dto.js";
import { VerifyOtpDto } from "./dto/verify-otp.dto.js";
import { RefreshDto } from "./dto/refresh.dto.js";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(OtpService) private readonly otpService: OtpService,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(ShopperService) private readonly shopperService: ShopperService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body() dto: RequestOtpDto,
    @Req() req: Request,
  ): Promise<{ status: "sent"; resendAvailableInSeconds: number }> {
    const phone = normalizePhone(dto.phone);
    const phoneHash = this.shopperService.hashPhone(phone);
    const clientIp = req.ip ?? "unknown";

    try {
      const code = await this.otpService.request(phoneHash, clientIp);
      await this.smsProvider.send(phone, `Your CheckoutKit OTP is ${code}`);
    } catch (err) {
      if (err instanceof OtpRateLimitedError) {
        throw new HttpException(err.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw err;
    }

    return { status: "sent", resendAvailableInSeconds: this.config.OTP_RESEND_COOLDOWN_SECONDS };
  }

  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const phone = normalizePhone(dto.phone);
    const phoneHash = this.shopperService.hashPhone(phone);

    try {
      await this.otpService.verify(phoneHash, dto.otp);
    } catch (err) {
      if (err instanceof OtpLockedError) {
        throw new HttpException(err.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (err instanceof OtpInvalidError) {
        throw new UnauthorizedException(err.message);
      }
      throw err;
    }

    const shopper = await this.shopperService.findOrCreateByPhone(phone);
    return this.tokenService.issueNewSession(shopper.id);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    try {
      return await this.tokenService.rotate(dto.refreshToken);
    } catch (err) {
      if (err instanceof RefreshTokenReuseError || err instanceof RefreshTokenInvalidError) {
        throw new UnauthorizedException(err.message);
      }
      throw err;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    try {
      await this.tokenService.revokeFamilyByToken(dto.refreshToken);
    } catch (err) {
      if (err instanceof RefreshTokenInvalidError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
