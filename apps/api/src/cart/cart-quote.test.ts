import { describe, expect, it } from "vitest";
import { quoteCart } from "./cart-quote.js";

describe("quoteCart", () => {
  const items = [
    { sku: "A", name: "Widget", quantity: 2, unitPriceCents: 1000 },
    { sku: "B", name: "Gadget", quantity: 1, unitPriceCents: 3000 },
  ];

  it("computes subtotal as sum of quantity * unitPrice", () => {
    const quote = quoteCart(items);
    expect(quote.subtotalCents).toBe(5000);
  });

  it("applies flat shipping below the free-shipping threshold", () => {
    const quote = quoteCart(items);
    expect(quote.shippingCents).toBe(4900);
  });

  it("waives shipping at or above the free-shipping threshold", () => {
    const bigOrder = [{ sku: "X", name: "Big", quantity: 1, unitPriceCents: 100000 }];
    expect(quoteCart(bigOrder).shippingCents).toBe(0);
  });

  it("applies the stub coupon case-insensitively", () => {
    const withCoupon = quoteCart(items, "save10");
    expect(withCoupon.discountCents).toBe(500);
  });

  it("ignores an unrecognized coupon code", () => {
    expect(quoteCart(items, "NOTREAL").discountCents).toBe(0);
  });

  it("computes tax on the post-discount subtotal, and totals everything correctly", () => {
    const quote = quoteCart(items, "SAVE10");
    const discounted = 5000 - 500;
    expect(quote.taxCents).toBe(Math.round(discounted * 0.18));
    expect(quote.totalCents).toBe(discounted + quote.shippingCents + quote.taxCents);
  });

  it("is deterministic for the same input", () => {
    expect(quoteCart(items, "SAVE10")).toEqual(quoteCart(items, "SAVE10"));
  });
});
