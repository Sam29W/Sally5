import type { RiskRule } from "../cod-risk-types.js";

export const orderVelocityRule: RiskRule = (input, config) =>
  input.recentOrderCount > config.velocityThreshold
    ? { points: 15, reason: "unusually high order velocity from this phone" }
    : null;
