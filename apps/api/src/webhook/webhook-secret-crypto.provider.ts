import type { Provider } from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { AesGcmCrypto } from "../crypto/aes-gcm.js";

export const WEBHOOK_SECRET_CRYPTO = "WEBHOOK_SECRET_CRYPTO";

export const webhookSecretCryptoProvider: Provider = {
  provide: WEBHOOK_SECRET_CRYPTO,
  inject: [CONFIG],
  useFactory: (config: AppConfig) => new AesGcmCrypto(config.WEBHOOK_SECRET_ENCRYPTION_KEY),
};
