import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

export class AesGcmCrypto {
  private readonly key: Buffer;

  constructor(encryptionKeyHex: string) {
    this.key = Buffer.from(encryptionKeyHex, "hex");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ciphertextB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !ciphertextB64) {
      throw new Error("Malformed encrypted payload");
    }
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
