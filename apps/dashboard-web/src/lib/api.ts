/** Thin fetch client for the merchant dashboard — every call after login carries the
 * dashboard JWT (see apps/api/src/dashboard-auth), never the merchant's own API key. */

export interface Order {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  gateway: string;
  status: string;
  amountCents: number;
  createdAt: string;
}

export interface CodRiskDecision {
  id: string;
  orderId: string;
  score: number;
  band: string;
  action: string;
  reasons: string[];
  createdAt: string;
}

export interface CodRiskConfig {
  highValueThresholdCents: number;
  lowAddressQualityThreshold: number;
  riskyHourStart: number;
  riskyHourEnd: number;
  velocityThreshold: number;
  lowBandMax: number;
  mediumBandMax: number;
  highRtoPincodes: string[];
  blockedPincodes: string[];
  blockedPhoneHashes: string[];
}

export interface ApiKeyInfo {
  id: string;
  prefix: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  createdAt: string;
}

export interface ShopifyStatus {
  connected: boolean;
  shopDomain?: string;
  scopes?: string;
  installedAt?: string;
  uninstalledAt?: string | null;
}

export interface DailyMetric {
  date: string;
  ordersCreated: number;
  paidOrCodConfirmed: number;
  delivered: number;
  rto: number;
  conversionRate: number;
  rtoRate: number;
}

export interface MerchantUser {
  id: string;
  email: string;
  role: "owner" | "ops" | "readonly";
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class DashboardApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; token?: string; apiKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    if (options.apiKey) headers["x-api-key"] = options.apiKey;
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

  bootstrapOwner(apiKey: string, email: string, password: string): Promise<{ status: "ok" }> {
    return this.request("/dashboard-auth/bootstrap", {
      method: "POST",
      apiKey,
      body: { email, password },
    });
  }

  login(email: string, password: string): Promise<{ accessToken: string }> {
    return this.request("/dashboard-auth/login", { method: "POST", body: { email, password } });
  }

  me(token: string): Promise<MerchantUser> {
    return this.request("/dashboard-auth/me", { token });
  }

  inviteUser(token: string, email: string, password: string, role: string): Promise<MerchantUser> {
    return this.request("/dashboard-auth/users", {
      method: "POST",
      token,
      body: { email, password, role },
    });
  }

  listOrders(token: string, status?: string): Promise<Order[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/dashboard/orders${qs}`, { token });
  }

  listPayments(token: string): Promise<Payment[]> {
    return this.request("/dashboard/payments", { token });
  }

  listCodRiskDecisions(token: string): Promise<CodRiskDecision[]> {
    return this.request("/dashboard/cod-risk-decisions", { token });
  }

  getCodRiskConfig(token: string): Promise<CodRiskConfig> {
    return this.request("/dashboard/cod-risk-config", { token });
  }

  updateCodRiskConfig(token: string, partial: Partial<CodRiskConfig>): Promise<CodRiskConfig> {
    return this.request("/dashboard/cod-risk-config", { method: "PUT", token, body: partial });
  }

  listApiKeys(token: string): Promise<ApiKeyInfo[]> {
    return this.request("/dashboard/api-keys", { token });
  }

  rotateApiKey(token: string): Promise<{ apiKey: string }> {
    return this.request("/dashboard/api-keys/rotate", { method: "POST", token });
  }

  listWebhooks(token: string): Promise<WebhookEndpoint[]> {
    return this.request("/dashboard/webhooks", { token });
  }

  getShopifyStatus(token: string): Promise<ShopifyStatus> {
    return this.request("/dashboard/shopify-status", { token });
  }

  getMetrics(token: string, days = 7): Promise<DailyMetric[]> {
    return this.request(`/dashboard/metrics?days=${days}`, { token });
  }
}
