/**
 * Server-only secret helpers (AES-256-GCM, HMAC, token hashing).
 * Import from "@nyxmail/shared/secrets" in Node runtimes only.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "nyxsec1";

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(value: string): T {
  return JSON.parse(decryptSecret(value)) as T;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function hmacSha256(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function hmacBase64(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashRecoveryPhrase(phrase: string): string {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  const pepper = process.env.RECOVERY_PEPPER;
  if (!pepper) throw new Error("RECOVERY_PEPPER is not configured");
  return hmacSha256(createHash("sha256").update(normalized).digest("hex"), pepper);
}

export function verifyRecoveryPhraseHash(phraseHashFromClient: string, storedHmac: string): boolean {
  const pepper = process.env.RECOVERY_PEPPER;
  if (!pepper) throw new Error("RECOVERY_PEPPER is not configured");
  return safeEqual(hmacSha256(phraseHashFromClient, pepper), storedHmac);
}

export function storeRecoveryPhraseHash(phraseHashFromClient: string): string {
  const pepper = process.env.RECOVERY_PEPPER;
  if (!pepper) throw new Error("RECOVERY_PEPPER is not configured");
  return hmacSha256(phraseHashFromClient, pepper);
}
