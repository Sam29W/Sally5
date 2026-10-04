import type {
  CodRiskConfig,
  CodRiskDecision,
  CodRiskInput,
  RiskAction,
  RiskBand,
  RiskRule,
} from "./cod-risk-types.js";
import { newPhoneRule } from "./rules/new-phone.rule.js";
import { highOrderValueRule } from "./rules/high-order-value.rule.js";
import { pincodeRtoHistoryRule } from "./rules/pincode-rto-history.rule.js";
import { lowAddressQualityRule } from "./rules/low-address-quality.rule.js";
import { timeOfDayRule } from "./rules/time-of-day.rule.js";
import { orderVelocityRule } from "./rules/order-velocity.rule.js";
import { BLOCKLIST_REASON, blocklistRule } from "./rules/blocklist.rule.js";

/** Order matters only for reason-list readability — every rule runs regardless, scoring
 * is a sum, so this is not a priority/short-circuit chain. */
const RULES: readonly RiskRule[] = [
  blocklistRule,
  newPhoneRule,
  highOrderValueRule,
  pincodeRtoHistoryRule,
  lowAddressQualityRule,
  timeOfDayRule,
  orderVelocityRule,
];

function bandFor(score: number, config: CodRiskConfig): RiskBand {
  if (score <= config.lowBandMax) return "low";
  if (score <= config.mediumBandMax) return "medium";
  return "high";
}

function actionFor(band: RiskBand, reasons: readonly string[]): RiskAction {
  if (reasons.includes(BLOCKLIST_REASON)) return "block";
  if (band === "low") return "allow";
  if (band === "medium") return "verify";
  return "nudge_to_prepaid";
}

/**
 * Pure and deterministic: the same (input, config) pair always produces the same
 * decision, with no I/O, no clock reads, no randomness — the caller supplies `orderHour`
 * and `recentOrderCount` precisely so this function never has to compute them itself.
 */
export function scoreCodRisk(input: CodRiskInput, config: CodRiskConfig): CodRiskDecision {
  const reasons: string[] = [];
  let score = 0;

  for (const rule of RULES) {
    const result = rule(input, config);
    if (result) {
      score += result.points;
      reasons.push(result.reason);
    }
  }

  const band = bandFor(score, config);
  const action = actionFor(band, reasons);

  return { score, band, action, reasons, ruleVersion: config.ruleVersion };
}
