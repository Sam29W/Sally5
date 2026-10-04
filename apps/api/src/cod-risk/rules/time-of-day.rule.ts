import type { RiskRule } from "../cod-risk-types.js";

/** Handles a risky window that wraps past midnight (e.g. start=22, end=5 means
 * 22:00-23:59 and 00:00-05:00 are both risky). */
function isWithinRiskyWindow(hour: number, start: number, end: number): boolean {
  if (start <= end) {
    return hour >= start && hour <= end;
  }
  return hour >= start || hour <= end;
}

export const timeOfDayRule: RiskRule = (input, config) =>
  isWithinRiskyWindow(input.orderHour, config.riskyHourStart, config.riskyHourEnd)
    ? { points: 10, reason: "order placed during a historically high-risk hour" }
    : null;
