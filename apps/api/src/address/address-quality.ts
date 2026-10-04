import { isValidIndianPincode } from "./pincode.util.js";

export interface AddressQualityInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
}

const JUNK_TOKENS = new Set(["test", "asdf", "xxxx", "na", "n/a", "none", "---"]);

function looksLikeJunk(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || JUNK_TOKENS.has(normalized);
}

/**
 * Pure, deterministic 0-100 completeness/validity score — no I/O, no DB lookups.
 * Used both to warn shoppers at checkout and as a COD-risk signal in Stage 5.
 */
export function scoreAddressQuality(address: AddressQualityInput): number {
  let score = 0;

  if (!looksLikeJunk(address.line1) && address.line1.trim().length >= 5) score += 30;
  if (!looksLikeJunk(address.city)) score += 20;
  if (!looksLikeJunk(address.state)) score += 20;
  if (isValidIndianPincode(address.pincode)) score += 25;
  if (address.line2 && !looksLikeJunk(address.line2)) score += 5;

  return score;
}
