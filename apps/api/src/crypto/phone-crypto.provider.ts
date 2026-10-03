import type { Provider } from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { PhoneCrypto } from "./phone-crypto.js";

export const phoneCryptoProvider: Provider = {
  provide: PhoneCrypto,
  inject: [CONFIG],
  useFactory: (config: AppConfig) =>
    new PhoneCrypto({
      encryptionKeyHex: config.PHONE_ENCRYPTION_KEY,
      hashKey: config.PHONE_HASH_KEY,
    }),
};
