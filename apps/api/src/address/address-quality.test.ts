import { describe, expect, it } from "vitest";
import { scoreAddressQuality } from "./address-quality.js";
import { isValidIndianPincode, normalizePincode } from "./pincode.util.js";

describe("scoreAddressQuality", () => {
  const complete = {
    line1: "221B Baker Colony Road",
    line2: "Near City Park",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
  };

  it("scores a complete, valid address at 100", () => {
    expect(scoreAddressQuality(complete)).toBe(100);
  });

  it("scores lower when line2 is absent", () => {
    expect(scoreAddressQuality({ ...complete, line2: undefined })).toBe(95);
  });

  it("scores lower for an invalid pincode", () => {
    expect(scoreAddressQuality({ ...complete, pincode: "123" })).toBe(75);
  });

  it("scores junk tokens as zero for that field", () => {
    expect(scoreAddressQuality({ ...complete, city: "test" })).toBe(80);
    expect(scoreAddressQuality({ ...complete, line1: "test" })).toBe(70);
  });

  it("is deterministic for the same input", () => {
    expect(scoreAddressQuality(complete)).toBe(scoreAddressQuality(complete));
  });
});

describe("pincode util", () => {
  it("normalizes whitespace", () => {
    expect(normalizePincode(" 400 001 ")).toBe("400001");
  });

  it("validates Indian 6-digit pincodes starting 1-9", () => {
    expect(isValidIndianPincode("400001")).toBe(true);
    expect(isValidIndianPincode("000001")).toBe(false);
    expect(isValidIndianPincode("4000011")).toBe(false);
    expect(isValidIndianPincode("abcdef")).toBe(false);
  });
});
