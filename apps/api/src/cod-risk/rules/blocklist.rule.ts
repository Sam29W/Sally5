import type { RiskRule } from "../cod-risk-types.js";

export const BLOCKLIST_REASON = "merchant blocklist match";

/**
 * Contributes enough points to guarantee the "high" band on its own, but deliberately
 * never includes *which* value matched (phone hash or pincode) in the reason string —
 * the blocklist itself is merchant-defined data, and reasons are the one place a
 * cross-merchant data leak could sneak in if we weren't careful here.
 */
export const blocklistRule: RiskRule = (input, config) => {
  const matched =
    config.blockedPhoneHashes.includes(input.phoneHash) ||
    config.blockedPincodes.includes(input.pincode);
  return matched ? { points: 100, reason: BLOCKLIST_REASON } : null;
};
