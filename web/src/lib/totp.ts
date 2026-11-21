import { authenticator } from "otplib";
import QRCode from "qrcode";
import { hashBackupCode, normalizeBackupCode } from "@nyxmail/crypto";
import { jsonStringArray } from "@nyxmail/db";

authenticator.options = { window: 1, step: 30 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, "NyxMail", secret);
}

export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#0B0E14", light: "#FFFFFF" },
  });
}

export function verifyTotp(code: string, secret: string): boolean {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(token)) return false;
  try {
    return authenticator.check(token, secret);
  } catch {
    return false;
  }
}

export async function consumeBackupCode(
  hashesJson: unknown,
  code: string,
): Promise<{ ok: boolean; remainingHashes: string[] }> {
  const hashes = jsonStringArray(hashesJson);
  const normalized = normalizeBackupCode(code);
  if (normalized.length !== 8) return { ok: false, remainingHashes: hashes };
  const hash = await hashBackupCode(normalized);
  const index = hashes.indexOf(hash);
  if (index === -1) return { ok: false, remainingHashes: hashes };
  return { ok: true, remainingHashes: hashes.filter((_, i) => i !== index) };
}
