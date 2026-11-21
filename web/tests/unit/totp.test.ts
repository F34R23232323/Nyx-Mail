import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { generateTotpSecret, totpUri, verifyTotp } from "../../src/lib/totp";
import { generateBackupCodes, hashBackupCode, normalizeBackupCode } from "@nyxmail/crypto";

describe("TOTP", () => {
  it("verifies a current authenticator code", () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(code, secret)).toBe(true);
    expect(verifyTotp("000000", secret)).toBe(false);
  });

  it("builds a standard otpauth URI", () => {
    const secret = generateTotpSecret();
    const uri = totpUri("user@example.com", secret);
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("NyxMail");
    expect(uri).toContain(`secret=${secret}`);
  });

  it("rejects malformed codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp("abc123", secret)).toBe(false);
    expect(verifyTotp("", secret)).toBe(false);
  });
});

describe("one-time backup codes", () => {
  it("hashes normalized codes", async () => {
    const codes = await generateBackupCodes(4);
    expect(codes.plain).toHaveLength(4);
    const first = codes.plain[0];
    expect(await hashBackupCode(normalizeBackupCode(first))).toBe(codes.hashes[0]);
    expect(await hashBackupCode("not-a-code")).not.toBe(codes.hashes[0]);
  });
});
