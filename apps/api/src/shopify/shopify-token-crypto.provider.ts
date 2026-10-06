import type { Provider } from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { AesGcmCrypto } from "../crypto/aes-gcm.js";

export const SHOPIFY_TOKEN_CRYPTO = "SHOPIFY_TOKEN_CRYPTO";

export const shopifyTokenCryptoProvider: Provider = {
  provide: SHOPIFY_TOKEN_CRYPTO,
  inject: [CONFIG],
  useFactory: (config: AppConfig) => new AesGcmCrypto(config.SHOPIFY_TOKEN_ENCRYPTION_KEY),
};
