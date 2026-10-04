import Razorpay from "razorpay";
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  GatewayPaymentStatus,
  PaymentGateway,
  RefundResult,
} from "../payment-gateway.js";

export interface RazorpayGatewayOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Base URL of our own checkout page — Razorpay's hosted Checkout.js runs client-side
   * against this order id, we never redirect to a Razorpay-hosted page server-side. */
  checkoutBaseUrl: string;
}

// Razorpay's Orders API status, not the payment-capture status — an order can be "paid"
// while the underlying payment is "captured"; we only need the order-level view here.
const ORDER_STATUS_MAP: Record<string, GatewayPaymentStatus> = {
  created: "pending",
  attempted: "pending",
  paid: "captured",
};

/** Real sandbox gateway. Reads its keys only from env vars (see razorpay-gateway.provider.ts)
 * — never hardcoded, never logged. No raw card or UPI data ever reaches this class or
 * anything upstream of it: Razorpay's Checkout.js collects payment details directly
 * against Razorpay's own servers client-side, using nothing but the order id this class
 * returns. */
export class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay";
  private readonly client: Razorpay;

  constructor(private readonly options: RazorpayGatewayOptions) {
    this.client = new Razorpay({ key_id: options.keyId, key_secret: options.keySecret });
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    // Razorpay's two-step flow: we create an *order* server-side; the shopper's browser
    // then collects payment via Checkout.js against that order id directly with Razorpay.
    // We store the order id as our gatewayPaymentId — it's the only reference we need.
    const order = await this.client.orders.create({
      amount: params.amountCents,
      currency: params.currency,
      notes: { checkoutkitOrderId: params.orderId },
    });
    return {
      gatewayPaymentId: order.id,
      checkoutUrl: `${this.options.checkoutBaseUrl}/pay/${order.id}`,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    return Razorpay.validateWebhookSignature(
      rawBody.toString("utf8"),
      signatureHeader,
      this.options.webhookSecret,
    );
  }

  async refund(gatewayPaymentId: string, amountCents: number): Promise<RefundResult> {
    const refund = await this.client.payments.refund(gatewayPaymentId, {
      amount: amountCents,
    });
    return { gatewayRefundId: refund.id };
  }

  async fetchStatus(gatewayPaymentId: string): Promise<GatewayPaymentStatus> {
    const order = await this.client.orders.fetch(gatewayPaymentId);
    return ORDER_STATUS_MAP[order.status] ?? "pending";
  }
}
