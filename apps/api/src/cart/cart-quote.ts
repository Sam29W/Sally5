export interface LineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CartQuote {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

const FLAT_SHIPPING_CENTS = 4900;
const FREE_SHIPPING_THRESHOLD_CENTS = 100000;
const TAX_RATE = 0.18;
// Stub coupon: a fixed 10% off, flagged in Stage 3's acceptance criteria as a stub to be
// replaced by a real coupon/promotions service in a later stage.
const STUB_COUPON_CODE = "SAVE10";
const STUB_COUPON_RATE = 0.1;

/** Pure, deterministic — no I/O. Shipping and tax are stand-ins per Stage 3 scope. */
export function quoteCart(items: LineItem[], couponCode?: string): CartQuote {
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);

  const discountCents =
    couponCode?.toUpperCase() === STUB_COUPON_CODE
      ? Math.round(subtotalCents * STUB_COUPON_RATE)
      : 0;

  const discountedSubtotal = subtotalCents - discountCents;
  const shippingCents =
    discountedSubtotal >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
  const taxCents = Math.round(discountedSubtotal * TAX_RATE);
  const totalCents = discountedSubtotal + shippingCents + taxCents;

  return { subtotalCents, discountCents, shippingCents, taxCents, totalCents };
}
