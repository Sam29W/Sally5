import { test, expect } from "@playwright/test";
import {
  createCart,
  createMerchant,
  createOrder,
  seedOtp,
  updateCodRiskConfig,
  uniquePhone,
} from "./helpers.js";

const CHEAP_ITEM = { sku: "SKU-CHEAP", name: "Everyday Item", quantity: 1, unitPriceCents: 49900 };
const EXPENSIVE_ITEM = {
  sku: "SKU-EXPENSIVE",
  name: "Premium Item",
  quantity: 1,
  unitPriceCents: 600000,
};

async function setupOrder(
  merchantName: string,
  items: typeof CHEAP_ITEM[],
): Promise<{ apiKey: string; cartId: string; orderId: string }> {
  const merchant = await createMerchant(merchantName);
  const cart = await createCart(merchant.apiKey, items);
  const order = await createOrder(merchant.apiKey, cart.id);
  return { apiKey: merchant.apiKey, cartId: cart.id, orderId: order.id };
}

async function verifyOtp(page: import("@playwright/test").Page, phone: string): Promise<void> {
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send OTP" }).click();
  // Wait for the real /auth/otp/request call to land (and its random code to be written
  // to Redis) before overwriting that state with our known code — otherwise this seed can
  // race the request and get clobbered by the real one a moment later.
  await page.getByLabel(/Enter the 6-digit code/).waitFor();
  await seedOtp(phone, "123456");
  await page.getByLabel(/Enter the 6-digit code/).fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
}

test.describe("Checkout — new shopper paying prepaid", () => {
  test("completes phone, OTP, address, and UPI payment", async ({ page }) => {
    const { cartId, orderId } = await setupOrder("E2E Prepaid Merchant", [CHEAP_ITEM]);
    const phone = uniquePhone();

    await page.goto(`/?cart=${cartId}&order=${orderId}`);
    await expect(page.getByText(/^Total: ₹/)).toBeVisible();

    await verifyOtp(page, phone);

    // First-time shopper has no saved addresses, so the form is shown directly.
    await page.getByLabel("Address line").fill("12 MG Road");
    await page.getByLabel("City").fill("Bengaluru");
    await page.getByLabel("State").fill("Karnataka");
    await page.getByLabel("Pincode").fill("560001");
    await page.getByRole("button", { name: "Save address" }).click();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Payment method")).toBeVisible();

    await page.getByRole("button", { name: /^Pay ₹/ }).click();

    await expect(page.getByText(/Processing your order|Order confirmed/)).toBeVisible();
    await expect(page.getByText(/Order status: payment_pending/)).toBeVisible();
  });
});

test.describe("Checkout — returning shopper with a saved address", () => {
  test("skips the address form and reuses the saved address", async ({ page }) => {
    const { cartId, orderId } = await setupOrder("E2E Returning Merchant", [CHEAP_ITEM]);
    const phone = uniquePhone();

    // First visit: verify OTP and save an address.
    await page.goto(`/?cart=${cartId}&order=${orderId}`);
    await verifyOtp(page, phone);
    await page.getByLabel("Address line").fill("45 Residency Road");
    await page.getByLabel("City").fill("Pune");
    await page.getByLabel("State").fill("Maharashtra");
    await page.getByLabel("Pincode").fill("411001");
    await page.getByRole("button", { name: "Save address" }).click();

    // Second visit on a fresh order for the same phone: the saved address should be
    // offered as a choice instead of an empty form.
    const second = await setupOrder("E2E Returning Merchant 2", [CHEAP_ITEM]);
    await page.goto(`/?cart=${second.cartId}&order=${second.orderId}`);
    await verifyOtp(page, phone);

    await expect(page.getByText("Choose an address")).toBeVisible();
    await expect(page.getByText(/45 Residency Road/)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Payment method")).toBeVisible();
  });
});

test.describe("Checkout — high-risk COD order gets nudged to prepaid", () => {
  test("shows the nudge banner and still allows COD after acknowledging", async ({ page }) => {
    const merchant = await createMerchant("E2E High-Risk Merchant");
    // Stack enough risk points to clear the "high" band regardless of the hour the test
    // runs at: new-phone(20) + high-order-value(15) + low-address-quality(20) +
    // pincode-RTO-history(25) = 80, safely over the default high-band threshold of 69.
    await updateCodRiskConfig(merchant.apiKey, {
      highRtoPincodes: ["560001"],
      lowAddressQualityThreshold: 50,
    });
    const cart = await createCart(merchant.apiKey, [EXPENSIVE_ITEM]);
    const order = await createOrder(merchant.apiKey, cart.id);
    const phone = uniquePhone();

    await page.goto(`/?cart=${cart.id}&order=${order.id}`);
    await verifyOtp(page, phone);

    // Deliberately low-quality address content (junk city/state) plus the RTO-flagged
    // pincode above — see apps/api/src/address/address-quality.ts for the scoring.
    await page.getByLabel("Address line").fill("test");
    await page.getByLabel("City").fill("test");
    await page.getByLabel("State").fill("test");
    await page.getByLabel("Pincode").fill("560001");
    await page.getByRole("button", { name: "Save address" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Cash on delivery").check();
    await expect(page.getByText(/We recommend/)).toBeVisible();

    await page.getByRole("button", { name: "Continue with COD anyway" }).click();
    await expect(page.getByText(/Order confirmed|Processing your order/)).toBeVisible();
    await expect(page.getByText(/Order status: cod_confirmed/)).toBeVisible();
  });
});

test.describe("Checkout — OTP failure path", () => {
  test("shows an error and lets the shopper retry with the correct code", async ({ page }) => {
    const { cartId, orderId } = await setupOrder("E2E OTP Failure Merchant", [CHEAP_ITEM]);
    const phone = uniquePhone();

    await page.goto(`/?cart=${cartId}&order=${orderId}`);
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByLabel(/Enter the 6-digit code/).waitFor();
    await seedOtp(phone, "123456");

    // Wrong code first.
    await page.getByLabel(/Enter the 6-digit code/).fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Incorrect code. Please try again.")).toBeVisible();

    // The field is cleared after a failure; re-seed (verify deletes the Redis state on
    // every attempt, success or failure is per the atomic VERIFY_SCRIPT) and retry.
    await seedOtp(phone, "123456");
    await page.getByLabel(/Enter the 6-digit code/).fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("Delivery address")).toBeVisible();
  });
});
