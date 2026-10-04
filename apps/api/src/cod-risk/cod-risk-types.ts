export const RULE_VERSION = "v1";

export type RiskBand = "low" | "medium" | "high";
export type RiskAction = "allow" | "verify" | "nudge_to_prepaid" | "block";

export interface CodRiskConfig {
  ruleVersion: string;
  highValueThresholdCents: number;
  lowAddressQualityThreshold: number;
  riskyHourStart: number;
  riskyHourEnd: number;
  velocityThreshold: number;
  lowBandMax: number;
  mediumBandMax: number;
  highRtoPincodes: readonly string[];
  blockedPincodes: readonly string[];
  blockedPhoneHashes: readonly string[];
}

export const DEFAULT_COD_RISK_CONFIG: CodRiskConfig = {
  ruleVersion: RULE_VERSION,
  highValueThresholdCents: 500000,
  lowAddressQualityThreshold: 50,
  riskyHourStart: 0,
  riskyHourEnd: 5,
  velocityThreshold: 3,
  lowBandMax: 39,
  mediumBandMax: 69,
  highRtoPincodes: [],
  blockedPincodes: [],
  blockedPhoneHashes: [],
};

export interface CodRiskInput {
  phoneHash: string;
  isNewPhone: boolean;
  orderValueCents: number;
  pincode: string;
  addressQualityScore: number;
  /** Hour of day (0-23) the order was placed, in the merchant's local reckoning. Passed
   * in rather than read from `new Date()` so scoring is deterministic and testable. */
  orderHour: number;
  /** Number of orders this phone has placed in the lookback window the caller defines
   * (e.g. last 24h) — velocity is a signal, not a clock the engine owns. */
  recentOrderCount: number;
}

export interface RiskRuleResult {
  points: number;
  reason: string;
}

export type RiskRule = (input: CodRiskInput, config: CodRiskConfig) => RiskRuleResult | null;

export interface CodRiskDecision {
  score: number;
  band: RiskBand;
  action: RiskAction;
  reasons: string[];
  ruleVersion: string;
}
