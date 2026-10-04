import type { RiskRule } from "../cod-risk-types.js";

export const lowAddressQualityRule: RiskRule = (input, config) =>
  input.addressQualityScore < config.lowAddressQualityThreshold
    ? { points: 20, reason: "delivery address quality score is low" }
    : null;
