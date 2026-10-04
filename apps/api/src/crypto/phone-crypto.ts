import { createHmac } from "node:crypto";
import { AesGcmCrypto } from "./aes-gcm.js";

export interface PhoneCryptoOptions {
  encryptionKeyHex: string;
  hashKey: string;
}

export class PhoneCrypto {
  private readonly aes: AesGcmCrypto;
  private readonly hashKey: string;

  constructor(options: PhoneCryptoOptions) {
    this.aes = new AesGcmCrypto(options.encryptionKeyHex);
    this.hashKey = options.hashKey;
  }

  encrypt(phone: string): string {
    return this.aes.encrypt(phone);
  }

  decrypt(payload: string): string {
    return this.aes.decrypt(payload);
  }

  /** Deterministic, for lookup only — never used to recover the original phone. */
  hash(phone: string): string {
    return createHmac("sha256", this.hashKey).update(phone).digest("hex");
  }
}
