import type { RiskRule } from "../cod-risk-types.js";

export const pincodeRtoHistoryRule: RiskRule = (input, config) =>
  config.highRtoPincodes.includes(input.pincode)
    ? { points: 25, reason: "delivery pincode has an elevated RTO history" }
    : null;
