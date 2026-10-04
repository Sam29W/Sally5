import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

export interface PhoneCryptoOptions {
  encryptionKeyHex: string;
  hashKey: string;
}

export class PhoneCrypto {
  private readonly key: Buffer;
  private readonly hashKey: string;

  constructor(options: PhoneCryptoOptions) {
    this.key = Buffer.from(options.encryptionKeyHex, "hex");
    this.hashKey = options.hashKey;
  }

  encrypt(phone: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ciphertextB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !ciphertextB64) {
      throw new Error("Malformed encrypted phone payload");
    }
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }

  /** Deterministic, for lookup only — never used to recover the original phone. */
  hash(phone: string): string {
    return createHmac("sha256", this.hashKey).update(phone).digest("hex");
  }
}
