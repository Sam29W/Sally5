import type { RiskRule } from "../cod-risk-types.js";

export const highOrderValueRule: RiskRule = (input, config) =>
  input.orderValueCents > config.highValueThresholdCents
    ? { points: 15, reason: "order value is above the high-value threshold" }
    : null;
