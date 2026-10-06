import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { MerchantRateLimiterService } from "./merchant-rate-limiter.service.js";
import {
  RATE_LIMIT_CATEGORY_KEY,
  type RateLimitCategory,
} from "./rate-limit-category.decorator.js";

/**
 * Applies to every route that presents an `x-api-key` header, regardless of whether
 * that key turns out to be valid — deliberately independent of `ApiKeyGuard`'s own
 * resolution (see MerchantRateLimiterService's header comment for why), so this guard
 * can be declared in any order relative to ApiKeyGuard without the two needing to
 * coordinate. Routes with no `x-api-key` header (shopper-facing, public-checkout,
 * dashboard) are untouched — they have their own limits (per-phone/per-IP OTP limits)
 * or none needed yet.
 */
@Injectable()
export class MerchantRateLimitGuard implements CanActivate {
  constructor(
    @Inject(MerchantRateLimiterService) private readonly limiter: MerchantRateLimiterService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = req.header("x-api-key");
    if (!apiKey) {
      return true;
    }

    const category =
      this.reflector.get<RateLimitCategory | undefined>(
        RATE_LIMIT_CATEGORY_KEY,
        context.getHandler(),
      ) ?? "general";
    const result = await this.limiter.checkAndIncrement(apiKey, category);

    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("X-RateLimit-Limit", result.limit);
    res.setHeader("X-RateLimit-Remaining", result.remaining);

    if (!result.allowed) {
      res.setHeader("Retry-After", result.resetSeconds);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded for "${category}" — try again in ${result.resetSeconds}s`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
