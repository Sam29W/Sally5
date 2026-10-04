import type { RiskRule } from "../cod-risk-types.js";

export const newPhoneRule: RiskRule = (input) =>
  input.isNewPhone ? { points: 20, reason: "new shopper — no prior orders on this phone" } : null;
