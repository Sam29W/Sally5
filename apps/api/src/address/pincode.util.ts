const INDIA_PINCODE_PATTERN = /^[1-9]\d{5}$/;

export function normalizePincode(input: string): string {
  return input.trim().replace(/\s+/g, "");
}

export function isValidIndianPincode(pincode: string): boolean {
  return INDIA_PINCODE_PATTERN.test(normalizePincode(pincode));
}
