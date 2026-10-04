import type { Provider } from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import type { PaymentGateway } from "./payment-gateway.js";
import { FakeGateway } from "./gateways/fake-gateway.js";
import { RazorpayGateway } from "./gateways/razorpay-gateway.js";

export const GATEWAY_REGISTRY = "GATEWAY_REGISTRY";

/** name -> gateway. Tests always get only "fake" registered (see payment.module.ts),
 * since RAZORPAY_* env vars are never set in the test environment. */
export type GatewayRegistry = Map<string, PaymentGateway>;

export const gatewayRegistryProvider: Provider = {
  provide: GATEWAY_REGISTRY,
  inject: [CONFIG],
  useFactory: (config: AppConfig): GatewayRegistry => {
    const registry: GatewayRegistry = new Map();
    const fake = new FakeGateway(config.FAKE_GATEWAY_WEBHOOK_SECRET);
    registry.set(fake.name, fake);

    if (config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET && config.RAZORPAY_WEBHOOK_SECRET) {
      const razorpay = new RazorpayGateway({
        keyId: config.RAZORPAY_KEY_ID,
        keySecret: config.RAZORPAY_KEY_SECRET,
        webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
        checkoutBaseUrl: config.CHECKOUT_BASE_URL,
      });
      registry.set(razorpay.name, razorpay);
    }

    return registry;
  },
};
