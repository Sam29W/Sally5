/** Thin fetch client for the checkout flow. Two trust tiers:
 * - `/public/*` — keyed by order/cart id as a bearer capability, no merchant secret ever
 *   reaches the browser (see apps/api/src/public-checkout for why this is safe).
 * - `/auth/*`, `/shopper/*` — shopper-authenticated via the access token OTP login hands
 *   back; never a merchant credential either. */

export interface LineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CartSummary {
  id: string;
  items: LineItem[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export interface OrderSummary {
  id: string;
  status: string;
  totalCents: number;
}

export interface Address {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  qualityScore: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface CodRiskResult {
  band: "low" | "medium" | "high";
  action: "allow" | "verify" | "nudge_to_prepaid" | "block";
  reasons: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class CheckoutApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; accessToken?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.accessToken) {
      headers["Authorization"] = `Bearer ${options.accessToken}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.message ?? `Request failed with ${res.status}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  requestOtp(phone: string): Promise<{ status: string; resendAvailableInSeconds: number }> {
    return this.request("/auth/otp/request", { method: "POST", body: { phone } });
  }

  verifyOtp(phone: string, otp: string): Promise<TokenPair> {
    return this.request("/auth/otp/verify", { method: "POST", body: { phone, otp } });
  }

  listAddresses(accessToken: string): Promise<Address[]> {
    return this.request("/shopper/addresses", { accessToken });
  }

  createAddress(
    accessToken: string,
    input: { line1: string; line2?: string; city: string; state: string; pincode: string },
  ): Promise<Address> {
    return this.request("/shopper/addresses", { method: "POST", body: input, accessToken });
  }

  getCart(cartId: string): Promise<CartSummary> {
    return this.request(`/public/carts/${cartId}`);
  }

  getOrder(orderId: string): Promise<OrderSummary> {
    return this.request(`/public/orders/${orderId}`);
  }

  claimOrder(orderId: string, accessToken: string): Promise<OrderSummary> {
    return this.request(`/public/orders/${orderId}/claim`, { method: "POST", accessToken });
  }

  createPayment(
    orderId: string,
    method: "card" | "upi" | "netbanking",
  ): Promise<{ id: string; gateway: string; status: string }> {
    return this.request(`/public/orders/${orderId}/payments`, { method: "POST", body: { method } });
  }

  scoreCodRisk(orderId: string, addressId: string): Promise<CodRiskResult> {
    return this.request(`/public/orders/${orderId}/cod-risk-score`, {
      method: "POST",
      body: { addressId },
    });
  }

  confirmCod(orderId: string): Promise<OrderSummary> {
    return this.request(`/public/orders/${orderId}/confirm-cod`, { method: "POST" });
  }
}
