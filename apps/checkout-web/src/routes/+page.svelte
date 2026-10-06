<script lang="ts">
  import {
    CheckoutApi,
    ApiError,
    type Address,
    type CartSummary,
    type CodRiskResult,
  } from "../lib/api.js";

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const api = new CheckoutApi(API_BASE_URL);

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const cartId = params.get("cart") ?? "";
  const orderId = params.get("order") ?? "";

  type Step = "phone" | "otp" | "address" | "payment" | "confirmation";

  let step = $state<Step>("phone");
  let phone = $state("");
  let otp = $state("");
  let accessToken = $state("");
  let error = $state("");
  let loading = $state(false);

  let cart = $state<CartSummary | null>(null);
  let addresses = $state<Address[]>([]);
  let selectedAddressId = $state("");
  let showAddAddress = $state(false);
  let newAddress = $state({ line1: "", city: "", state: "", pincode: "" });

  let paymentMethod = $state<"upi" | "card" | "netbanking" | "cod">("upi");
  let codRisk = $state<CodRiskResult | null>(null);
  let orderStatus = $state("");

  const totalDisplay = $derived(cart ? (cart.totalCents / 100).toFixed(2) : "0.00");

  async function loadCart() {
    try {
      cart = await api.getCart(cartId);
    } catch {
      error = "Could not load your cart. Please go back and try again.";
    }
  }
  if (cartId) void loadCart();

  async function submitPhone(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      await api.requestOtp(phone);
      step = "otp";
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not send OTP. Try again.";
    } finally {
      loading = false;
    }
  }

  async function submitOtp(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      const tokens = await api.verifyOtp(phone, otp);
      accessToken = tokens.accessToken;
      if (orderId) await api.claimOrder(orderId, accessToken);
      const list = await api.listAddresses(accessToken);
      addresses = list;
      selectedAddressId = list.find((a) => a.isDefault)?.id ?? list[0]?.id ?? "";
      showAddAddress = list.length === 0;
      step = "address";
    } catch (err) {
      error =
        err instanceof ApiError ? "Incorrect code. Please try again." : "Something went wrong.";
      otp = "";
    } finally {
      loading = false;
    }
  }

  async function submitNewAddress(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      const created = await api.createAddress(accessToken, newAddress);
      addresses = [...addresses, created];
      selectedAddressId = created.id;
      showAddAddress = false;
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not save that address.";
    } finally {
      loading = false;
    }
  }

  function proceedToPayment() {
    if (!selectedAddressId) {
      error = "Please choose or add a delivery address.";
      return;
    }
    error = "";
    step = "payment";
  }

  async function chooseCod() {
    paymentMethod = "cod";
    loading = true;
    error = "";
    try {
      codRisk = await api.scoreCodRisk(orderId, selectedAddressId);
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not evaluate COD for this order.";
    } finally {
      loading = false;
    }
  }

  async function confirmCod() {
    loading = true;
    error = "";
    try {
      const order = await api.confirmCod(orderId);
      orderStatus = order.status;
      step = "confirmation";
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not confirm your COD order.";
    } finally {
      loading = false;
    }
  }

  async function payPrepaid() {
    loading = true;
    error = "";
    try {
      await api.createPayment(orderId, paymentMethod === "cod" ? "upi" : paymentMethod);
      orderStatus = "payment_pending";
      step = "confirmation";
      void pollOrderStatus();
    } catch (err) {
      error = err instanceof ApiError ? err.message : "Could not start payment.";
    } finally {
      loading = false;
    }
  }

  async function pollOrderStatus() {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const order = await api.getOrder(orderId);
        orderStatus = order.status;
        if (order.status === "paid" || order.status === "cod_confirmed") return;
      } catch {
        return;
      }
    }
  }
</script>

<main>
  <h1>Secure Checkout</h1>

  {#if cart}
    <p class="summary" aria-live="polite">Total: ₹{totalDisplay}</p>
  {/if}

  {#if error}
    <p role="alert" class="error">{error}</p>
  {/if}

  {#if step === "phone"}
    <form onsubmit={submitPhone}>
      <label for="phone">Mobile number</label>
      <input
        id="phone"
        type="tel"
        bind:value={phone}
        placeholder="+919876543210"
        required
        autocomplete="tel"
      />
      <button type="submit" disabled={loading}>Send OTP</button>
    </form>
  {:else if step === "otp"}
    <form onsubmit={submitOtp}>
      <label for="otp">Enter the 6-digit code sent to {phone}</label>
      <input
        id="otp"
        type="text"
        inputmode="numeric"
        pattern={"[0-9]{6}"}
        maxlength="6"
        bind:value={otp}
        required
        autocomplete="one-time-code"
      />
      <button type="submit" disabled={loading}>Verify</button>
    </form>
  {:else if step === "address"}
    <h2>Delivery address</h2>
    {#if addresses.length > 0 && !showAddAddress}
      <fieldset>
        <legend>Choose an address</legend>
        {#each addresses as addr (addr.id)}
          <label class="address-option">
            <input type="radio" name="address" value={addr.id} bind:group={selectedAddressId} />
            {addr.line1}, {addr.city}, {addr.state}
            {addr.pincode}
          </label>
        {/each}
      </fieldset>
      <button type="button" onclick={() => (showAddAddress = true)}>Add a new address</button>
      <button type="button" onclick={proceedToPayment} disabled={loading}>Continue</button>
    {:else}
      <form onsubmit={submitNewAddress}>
        <label for="line1">Address line</label>
        <input id="line1" bind:value={newAddress.line1} required />
        <label for="city">City</label>
        <input id="city" bind:value={newAddress.city} required />
        <label for="state">State</label>
        <input id="state" bind:value={newAddress.state} required />
        <label for="pincode">Pincode</label>
        <input id="pincode" bind:value={newAddress.pincode} required pattern={"[0-9]{6}"} />
        <button type="submit" disabled={loading}>Save address</button>
        {#if addresses.length > 0}
          <button type="button" onclick={() => (showAddAddress = false)}>Cancel</button>
        {/if}
      </form>
    {/if}
  {:else if step === "payment"}
    <h2>Payment method</h2>
    <div class="payment-methods" role="radiogroup" aria-label="Payment method">
      <label><input type="radio" bind:group={paymentMethod} value="upi" /> UPI</label>
      <label><input type="radio" bind:group={paymentMethod} value="card" /> Card</label>
      <label><input type="radio" bind:group={paymentMethod} value="netbanking" /> Netbanking</label>
      <label>
        <input
          type="radio"
          name="paymentMethod"
          value="cod"
          checked={paymentMethod === "cod"}
          onchange={chooseCod}
        /> Cash on delivery
      </label>
    </div>

    {#if paymentMethod === "cod" && codRisk}
      {#if codRisk.action === "block"}
        <p class="risk-banner risk-block" role="alert">
          Cash on delivery isn't available for this order. Please choose a prepaid method.
        </p>
      {:else if codRisk.action === "nudge_to_prepaid"}
        <p class="risk-banner risk-nudge">
          Prepaid orders ship faster and are more reliable for this address. We recommend paying
          online instead.
        </p>
        <button type="button" onclick={confirmCod} disabled={loading}>
          Continue with COD anyway
        </button>
      {:else}
        <button type="button" onclick={confirmCod} disabled={loading}>Confirm COD order</button>
      {/if}
    {:else if paymentMethod !== "cod"}
      <button type="button" onclick={payPrepaid} disabled={loading}>Pay ₹{totalDisplay}</button>
    {/if}
  {:else if step === "confirmation"}
    <h2>
      {#if orderStatus === "paid" || orderStatus === "cod_confirmed"}
        Order confirmed!
      {:else}
        Processing your order…
      {/if}
    </h2>
    <p aria-live="polite">Order status: {orderStatus}</p>
  {/if}
</main>

<style>
  main {
    max-width: 28rem;
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
  }
  label {
    font-size: 0.9rem;
  }
  input {
    padding: 0.6rem;
    font-size: 1rem;
    border: 1px solid #ccc;
    border-radius: 0.375rem;
  }
  button {
    padding: 0.6rem 1rem;
    font-size: 1rem;
    border-radius: 0.375rem;
    border: none;
    background: #111827;
    color: white;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    color: #b91c1c;
  }
  .address-option {
    display: block;
    padding: 0.4rem 0;
  }
  .payment-methods {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
  }
  .risk-banner {
    padding: 0.6rem;
    border-radius: 0.375rem;
    margin-bottom: 0.5rem;
  }
  .risk-nudge {
    background: #fef3c7;
  }
  .risk-block {
    background: #fee2e2;
    color: #991b1b;
  }
  .summary {
    font-weight: 600;
  }
</style>
