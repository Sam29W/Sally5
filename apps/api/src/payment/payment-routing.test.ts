import { describe, expect, it } from "vitest";
import { NoGatewayAvailableError, selectGateway } from "./payment-routing.js";

describe("selectGateway", () => {
  it("prefers razorpay when both are available", () => {
    expect(selectGateway(new Set(["razorpay", "fake"]), "upi", 1000)).toBe("razorpay");
  });

  it("falls back to fake when razorpay isn't configured", () => {
    expect(selectGateway(new Set(["fake"]), "card", 1000)).toBe("fake");
  });

  it("throws when no candidate gateway is available", () => {
    expect(() => selectGateway(new Set(), "upi", 1000)).toThrow(NoGatewayAvailableError);
  });

  it("applies the same rule across all methods", () => {
    for (const method of ["card", "upi", "netbanking"] as const) {
      expect(selectGateway(new Set(["fake"]), method, 500)).toBe("fake");
    }
  });
});
