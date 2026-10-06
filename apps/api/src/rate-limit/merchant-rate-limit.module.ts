import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { MerchantRateLimiterService } from "./merchant-rate-limiter.service.js";
import { MerchantRateLimitGuard } from "./merchant-rate-limit.guard.js";

/** Registered as a global guard (APP_GUARD) so every route that presents an
 * `x-api-key` header is covered without having to remember to add `@UseGuards` to each
 * new merchant-facing controller — see MerchantRateLimitGuard for why it's safe to run
 * globally regardless of whether a given route actually belongs to a merchant. */
@Module({
  providers: [MerchantRateLimiterService, { provide: APP_GUARD, useClass: MerchantRateLimitGuard }],
  exports: [MerchantRateLimiterService],
})
export class MerchantRateLimitModule {}
