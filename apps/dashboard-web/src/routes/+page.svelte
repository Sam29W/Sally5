<script lang="ts">
  import { onMount } from "svelte";
  import {
    DashboardApi,
    ApiError,
    type Order,
    type CodRiskConfig,
    type ApiKeyInfo,
    type WebhookEndpoint,
    type ShopifyStatus,
    type DailyMetric,
    type MerchantUser,
  } from "../lib/api.js";

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const api = new DashboardApi(API_BASE_URL);

  type View = "login" | "bootstrap" | "home";
  type Tab = "orders" | "metrics" | "risk" | "api-keys" | "webhooks" | "sync";

  let view = $state<View>("login");
  let tab = $state<Tab>("orders");
  let error = $state("");
  let loading = $state(false);

  let token = $state(
    typeof window !== "undefined" ? (sessionStorage.getItem("dashboard_token") ?? "") : "",
  );
  let me = $state<MerchantUser | null>(null);

  // Login form
  let loginEmail = $state("");
  let loginPassword = $state("");

  // Bootstrap form (first owner, proven via the merchant's own API key)
  let bootstrapApiKey = $state("");
  let bootstrapEmail = $state("");
  let bootstrapPassword = $state("");

  // Data
  let orders = $state<Order[]>([]);
  let metrics = $state<DailyMetric[]>([]);
  let riskConfig = $state<CodRiskConfig | null>(null);
  let apiKeys = $state<ApiKeyInfo[]>([]);
  let webhooks = $state<WebhookEndpoint[]>([]);
  let shopifyStatus = $state<ShopifyStatus | null>(null);
  let rotatedKey = $state("");

  function setToken(value: string) {
    token = value;
    if (typeof window !== "undefined") sessionStorage.setItem("dashboard_token", value);
  }

  function logout() {
    token = "";
    me = null;
    view = "login";
    if (typeof window !== "undefined") sessionStorage.removeItem("dashboard_token");
  }

  async function submitLogin(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      const { accessToken } = await api.login(loginEmail, loginPassword);
      setToken(accessToken);
      me = await api.me(accessToken);
      view = "home";
      await loadTab("orders");
    } catch (err) {
      error = err instanceof ApiError ? "Invalid email or password." : "Could not log in.";
    } finally {
      loading = false;
    }
  }

  async function submitBootstrap(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      await api.bootstrapOwner(bootstrapApiKey, bootstrapEmail, bootstrapPassword);
      loginEmail = bootstrapEmail;
      loginPassword = bootstrapPassword;
      view = "login";
    } catch (err) {
      error =
        err instanceof ApiError && err.status === 409
          ? "This merchant already has an owner account — log in instead."
          : "Could not create the owner account. Check the API key.";
    } finally {
      loading = false;
    }
  }

  async function loadTab(next: Tab) {
    tab = next;
    error = "";
    loading = true;
    try {
      if (next === "orders") orders = await api.listOrders(token);
      else if (next === "metrics") metrics = await api.getMetrics(token, 7);
      else if (next === "risk") riskConfig = await api.getCodRiskConfig(token);
      else if (next === "api-keys") apiKeys = await api.listApiKeys(token);
      else if (next === "webhooks") webhooks = await api.listWebhooks(token);
      else if (next === "sync") shopifyStatus = await api.getShopifyStatus(token);
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not load this tab.";
    } finally {
      loading = false;
    }
  }

  async function saveRiskConfig() {
    if (!riskConfig) return;
    error = "";
    loading = true;
    try {
      // Only the fields this form actually edits — the fetched config carries read-only
      // fields (ruleVersion, blocklists) the update DTO's forbidNonWhitelisted rejects.
      riskConfig = await api.updateCodRiskConfig(token, {
        highValueThresholdCents: riskConfig.highValueThresholdCents,
        lowAddressQualityThreshold: riskConfig.lowAddressQualityThreshold,
        lowBandMax: riskConfig.lowBandMax,
        mediumBandMax: riskConfig.mediumBandMax,
      });
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not save the risk config.";
    } finally {
      loading = false;
    }
  }

  async function doRotateApiKey() {
    error = "";
    loading = true;
    try {
      const result = await api.rotateApiKey(token);
      rotatedKey = result.apiKey;
      apiKeys = await api.listApiKeys(token);
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not rotate the API key.";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const initialToken = token;
    if (!initialToken) return;
    void (async () => {
      try {
        me = await api.me(initialToken);
        view = "home";
        await loadTab("orders");
      } catch {
        logout();
      }
    })();
  });
</script>

<main>
  <h1>CheckoutKit Dashboard</h1>

  {#if error}
    <p role="alert" class="error">{error}</p>
  {/if}

  {#if view === "login"}
    <form onsubmit={submitLogin}>
      <label for="login-email">Email</label>
      <input id="login-email" type="email" bind:value={loginEmail} required />
      <label for="login-password">Password</label>
      <input id="login-password" type="password" bind:value={loginPassword} required />
      <button type="submit" disabled={loading}>Log in</button>
      <button type="button" onclick={() => (view = "bootstrap")}>
        First time? Create the owner account
      </button>
    </form>
  {:else if view === "bootstrap"}
    <form onsubmit={submitBootstrap}>
      <p>
        Creating the first owner account requires your merchant API key — the same secret your
        backend uses to call the CheckoutKit API.
      </p>
      <label for="bootstrap-key">Merchant API key</label>
      <input id="bootstrap-key" bind:value={bootstrapApiKey} required />
      <label for="bootstrap-email">Owner email</label>
      <input id="bootstrap-email" type="email" bind:value={bootstrapEmail} required />
      <label for="bootstrap-password">Owner password</label>
      <input
        id="bootstrap-password"
        type="password"
        bind:value={bootstrapPassword}
        minlength="12"
        required
      />
      <button type="submit" disabled={loading}>Create owner account</button>
      <button type="button" onclick={() => (view = "login")}>Back to login</button>
    </form>
  {:else if view === "home"}
    <div class="topbar">
      <span>Signed in as {me?.email} ({me?.role})</span>
      <button type="button" onclick={logout}>Log out</button>
    </div>

    <nav>
      <button class:active={tab === "orders"} onclick={() => loadTab("orders")}>Orders</button>
      <button class:active={tab === "metrics"} onclick={() => loadTab("metrics")}>Metrics</button>
      <button class:active={tab === "risk"} onclick={() => loadTab("risk")}>COD Risk</button>
      {#if me?.role === "owner"}
        <button class:active={tab === "api-keys"} onclick={() => loadTab("api-keys")}>
          API Keys
        </button>
      {/if}
      {#if me?.role === "owner" || me?.role === "ops"}
        <button class:active={tab === "webhooks"} onclick={() => loadTab("webhooks")}>
          Webhooks
        </button>
      {/if}
      <button class:active={tab === "sync"} onclick={() => loadTab("sync")}>Shopify Sync</button>
    </nav>

    {#if tab === "orders"}
      <table>
        <thead>
          <tr><th>ID</th><th>Status</th><th>Total</th><th>Created</th></tr>
        </thead>
        <tbody>
          {#each orders as order (order.id)}
            <tr>
              <td>{order.id.slice(0, 8)}</td>
              <td>{order.status}</td>
              <td>₹{(order.totalCents / 100).toFixed(2)}</td>
              <td>{new Date(order.createdAt).toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === "metrics"}
      <table>
        <thead>
          <tr>
            <th>Date (IST)</th><th>Created</th><th>Converted</th><th>Delivered</th><th>RTO</th><th
              >Conversion %</th
            ><th>RTO %</th>
          </tr>
        </thead>
        <tbody>
          {#each metrics as day (day.date)}
            <tr>
              <td>{day.date}</td>
              <td>{day.ordersCreated}</td>
              <td>{day.paidOrCodConfirmed}</td>
              <td>{day.delivered}</td>
              <td>{day.rto}</td>
              <td>{(day.conversionRate * 100).toFixed(1)}%</td>
              <td>{(day.rtoRate * 100).toFixed(1)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === "risk" && riskConfig}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          saveRiskConfig();
        }}
      >
        <label for="high-value">High-value threshold (cents)</label>
        <input id="high-value" type="number" bind:value={riskConfig.highValueThresholdCents} />
        <label for="low-addr">Low address-quality threshold</label>
        <input id="low-addr" type="number" bind:value={riskConfig.lowAddressQualityThreshold} />
        <label for="low-band">Low band max score</label>
        <input id="low-band" type="number" bind:value={riskConfig.lowBandMax} />
        <label for="medium-band">Medium band max score</label>
        <input id="medium-band" type="number" bind:value={riskConfig.mediumBandMax} />
        <button type="submit" disabled={loading}>Save</button>
      </form>
    {:else if tab === "api-keys"}
      {#if rotatedKey}
        <p class="rotated-key">
          New key (shown once): <code>{rotatedKey}</code>
        </p>
      {/if}
      <button type="button" onclick={doRotateApiKey} disabled={loading}>Rotate API key</button>
      <table>
        <thead>
          <tr><th>Prefix</th><th>Created</th><th>Revoked</th></tr>
        </thead>
        <tbody>
          {#each apiKeys as key (key.id)}
            <tr>
              <td>{key.prefix}</td>
              <td>{new Date(key.createdAt).toLocaleString()}</td>
              <td>{key.revokedAt ? new Date(key.revokedAt).toLocaleString() : "active"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === "webhooks"}
      <table>
        <thead>
          <tr><th>URL</th><th>Created</th></tr>
        </thead>
        <tbody>
          {#each webhooks as hook (hook.id)}
            <tr>
              <td>{hook.url}</td>
              <td>{new Date(hook.createdAt).toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if tab === "sync" && shopifyStatus}
      {#if shopifyStatus.connected}
        <p>
          Connected to <strong>{shopifyStatus.shopDomain}</strong> (scopes:
          {shopifyStatus.scopes})
        </p>
        <p>Installed: {new Date(shopifyStatus.installedAt ?? "").toLocaleString()}</p>
      {:else}
        <p>No Shopify store connected.</p>
      {/if}
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1rem;
    font-family: system-ui, sans-serif;
  }
  h1 {
    font-size: 1.25rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 24rem;
  }
  label {
    font-size: 0.9rem;
  }
  input {
    padding: 0.5rem;
    font-size: 1rem;
    border: 1px solid #ccc;
    border-radius: 0.375rem;
  }
  button {
    padding: 0.5rem 1rem;
    font-size: 0.95rem;
    border-radius: 0.375rem;
    border: 1px solid #111827;
    background: #111827;
    color: white;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  nav {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  nav button {
    background: white;
    color: #111827;
  }
  nav button.active {
    background: #111827;
    color: white;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .error {
    color: #b91c1c;
  }
  .rotated-key {
    background: #fef3c7;
    padding: 0.5rem;
    border-radius: 0.375rem;
    word-break: break-all;
  }
</style>
