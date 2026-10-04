import { describe, expect, it } from "vitest";
import { scoreCodRisk } from "./cod-risk-engine.js";
import {
  DEFAULT_COD_RISK_CONFIG,
  type CodRiskConfig,
  type CodRiskInput,
} from "./cod-risk-types.js";
import { newPhoneRule } from "./rules/new-phone.rule.js";
import { highOrderValueRule } from "./rules/high-order-value.rule.js";
import { pincodeRtoHistoryRule } from "./rules/pincode-rto-history.rule.js";
import { lowAddressQualityRule } from "./rules/low-address-quality.rule.js";
import { timeOfDayRule } from "./rules/time-of-day.rule.js";
import { orderVelocityRule } from "./rules/order-velocity.rule.js";
import { BLOCKLIST_REASON, blocklistRule } from "./rules/blocklist.rule.js";

const CONFIG: CodRiskConfig = DEFAULT_COD_RISK_CONFIG;

const CLEAN_INPUT: CodRiskInput = {
  phoneHash: "hash_clean",
  isNewPhone: false,
  orderValueCents: 100000,
  pincode: "400001",
  addressQualityScore: 90,
  orderHour: 14,
  recentOrderCount: 1,
};

describe("individual rules", () => {
  it("newPhoneRule fires only for a new phone", () => {
    expect(newPhoneRule({ ...CLEAN_INPUT, isNewPhone: true }, CONFIG)).toEqual({
      points: 20,
      reason: expect.stringContaining("new shopper"),
    });
    expect(newPhoneRule({ ...CLEAN_INPUT, isNewPhone: false }, CONFIG)).toBeNull();
  });

  it("highOrderValueRule fires only above the threshold", () => {
    expect(highOrderValueRule({ ...CLEAN_INPUT, orderValueCents: 600000 }, CONFIG)).not.toBeNull();
    expect(highOrderValueRule({ ...CLEAN_INPUT, orderValueCents: 500000 }, CONFIG)).toBeNull();
  });

  it("pincodeRtoHistoryRule fires only for a listed pincode", () => {
    const config = { ...CONFIG, highRtoPincodes: ["110001"] };
    expect(pincodeRtoHistoryRule({ ...CLEAN_INPUT, pincode: "110001" }, config)).not.toBeNull();
    expect(pincodeRtoHistoryRule({ ...CLEAN_INPUT, pincode: "400001" }, config)).toBeNull();
  });

  it("lowAddressQualityRule fires only below the threshold", () => {
    expect(
      lowAddressQualityRule({ ...CLEAN_INPUT, addressQualityScore: 49 }, CONFIG),
    ).not.toBeNull();
    expect(lowAddressQualityRule({ ...CLEAN_INPUT, addressQualityScore: 50 }, CONFIG)).toBeNull();
  });

  it("timeOfDayRule fires within the risky window, including wrap-past-midnight", () => {
    expect(timeOfDayRule({ ...CLEAN_INPUT, orderHour: 2 }, CONFIG)).not.toBeNull();
    expect(timeOfDayRule({ ...CLEAN_INPUT, orderHour: 14 }, CONFIG)).toBeNull();

    const wrapping = { ...CONFIG, riskyHourStart: 22, riskyHourEnd: 5 };
    expect(timeOfDayRule({ ...CLEAN_INPUT, orderHour: 23 }, wrapping)).not.toBeNull();
    expect(timeOfDayRule({ ...CLEAN_INPUT, orderHour: 3 }, wrapping)).not.toBeNull();
    expect(timeOfDayRule({ ...CLEAN_INPUT, orderHour: 12 }, wrapping)).toBeNull();
  });

  it("orderVelocityRule fires only above the threshold", () => {
    expect(orderVelocityRule({ ...CLEAN_INPUT, recentOrderCount: 4 }, CONFIG)).not.toBeNull();
    expect(orderVelocityRule({ ...CLEAN_INPUT, recentOrderCount: 3 }, CONFIG)).toBeNull();
  });

  it("blocklistRule fires on a blocked phone or pincode, with a generic reason only", () => {
    const config = { ...CONFIG, blockedPhoneHashes: ["blocked_hash"] };
    const result = blocklistRule({ ...CLEAN_INPUT, phoneHash: "blocked_hash" }, config);
    expect(result).toEqual({ points: 100, reason: BLOCKLIST_REASON });
    expect(blocklistRule(CLEAN_INPUT, config)).toBeNull();
  });
});

describe("scoreCodRisk", () => {
  it("scores a clean order as low risk, allow", () => {
    const decision = scoreCodRisk(CLEAN_INPUT, CONFIG);
    expect(decision.score).toBe(0);
    expect(decision.band).toBe("low");
    expect(decision.action).toBe("allow");
    expect(decision.reasons).toEqual([]);
  });

  it("stacks multiple triggered rules into a higher band", () => {
    const risky: CodRiskInput = {
      ...CLEAN_INPUT,
      isNewPhone: true,
      orderValueCents: 600000,
      addressQualityScore: 30,
    };
    const decision = scoreCodRisk(risky, CONFIG);
    expect(decision.score).toBe(20 + 15 + 20);
    expect(decision.band).toBe("medium");
    expect(decision.action).toBe("verify");
    expect(decision.reasons).toHaveLength(3);
  });

  it("a blocklist match always forces action=block regardless of other signals", () => {
    const config = { ...CONFIG, blockedPincodes: ["400001"] };
    const decision = scoreCodRisk(CLEAN_INPUT, config);
    expect(decision.action).toBe("block");
    expect(decision.band).toBe("high");
    expect(decision.reasons).toContain(BLOCKLIST_REASON);
  });

  it("is deterministic: the same input and config always produce the same decision", () => {
    const risky: CodRiskInput = { ...CLEAN_INPUT, isNewPhone: true, recentOrderCount: 10 };
    const first = scoreCodRisk(risky, CONFIG);
    const second = scoreCodRisk(risky, CONFIG);
    expect(second).toEqual(first);
  });

  it("stamps every decision with the engine's rule version", () => {
    expect(scoreCodRisk(CLEAN_INPUT, CONFIG).ruleVersion).toBe(CONFIG.ruleVersion);
  });
});
