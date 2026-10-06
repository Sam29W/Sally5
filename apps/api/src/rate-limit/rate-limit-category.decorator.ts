import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_CATEGORY_KEY = "rate_limit_category";

export type RateLimitCategory = "general" | "cod-risk" | "payments";

/** Tags a route with a rate-limit category other than the "general" default. See
 * merchant-rate-limit.guard.ts for how the category maps to a configured limit. */
export const RateLimitCategoryTag = (category: RateLimitCategory) =>
  SetMetadata(RATE_LIMIT_CATEGORY_KEY, category);
