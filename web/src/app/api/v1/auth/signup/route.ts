import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { signupHostedDomains } from "@nyxmail/server";
import { encryptSecret, storeRecoveryPhraseHash } from "@nyxmail/shared/secrets";
import { signupSchema } from "@/lib/validation";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { signFlowToken } from "@/lib/auth";
import { hashPassword, passwordLooksAcceptable } from "@/lib/passwords";
import { SYSTEM_FOLDERS } from "@/lib/folders";
import { maxStorageBytes } from "@/lib/env";
import { consumeLimit, limiterKeys, rateLimit } from "@/lib/rate-limit";
import { generateTotpSecret, totpQrDataUrl, totpUri } from "@/lib/totp";
import { domainOf, normalizeEmail } from "@nyxmail/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validPublicKey(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

function validSalt(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 16;
  } catch {
    return false;
  }
}

function validEnvelope(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts[0] === "nyx1" && parts[1].length >= 16 && parts[2].length > 20;
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const keys = limiterKeys(ip);
    await consumeLimit(keys.signup(), 6, 60 * 60 * 1000, "Too many accounts created from this address");
    const signupLimit = await rateLimit(`signup-global:${ip}`, 10, 60 * 60 * 1000);
    if (!signupLimit.success) throw new ApiError(429, "Too many attempts", "rate_limited");

    const body = await parseBody(request, signupSchema);
    const email = normalizeEmail(body.email);
    const allowedSignupDomains = await signupHostedDomains();
    if (!allowedSignupDomains.includes(domainOf(email))) {
      throw new ApiError(
        400,
        `Signups are restricted to ${allowedSignupDomains.map((domain) => `@${domain}`).join(", ")}`,
        "domain_restricted",
      );
    }
    if (!validPublicKey(body.publicKey) || !validPublicKey(body.signingPublicKey)) {
      throw new ApiError(400, "Invalid public key", "invalid_keys");
    }
    if (!validEnvelope(body.encryptedPrivateKey) || !validEnvelope(body.recoveryEncryptedPrivateKey)) {
      throw new ApiError(400, "Invalid encrypted key envelope", "invalid_keys");
    }
    if (!validSalt(body.argonSalt) || !validSalt(body.recoverySalt)) {
      throw new ApiError(400, "Invalid KDF salt", "invalid_keys");
    }
    const passwordError = passwordLooksAcceptable(body.password, email);
    if (passwordError) throw new ApiError(400, passwordError, "weak_password");
    if (!/^[a-f0-9]{64}$/i.test(body.recoveryKeyHash)) {
      throw new ApiError(400, "Invalid recovery key hash", "invalid_recovery");
    }
    if (body.recoveryEmail && normalizeEmail(body.recoveryEmail) === email) {
      throw new ApiError(400, "Recovery email must be different from your NyxMail address", "invalid_recovery");
    }

    const [existingUser, existingAlias] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.alias.findUnique({ where: { address: email }, select: { id: true } }),
    ]);
    if (existingUser || existingAlias) {
      throw new ApiError(409, "An account with that address already exists", "email_taken");
    }

    const passwordHash = await hashPassword(body.password);
    const totpSecret = generateTotpSecret();
    const isFirstUser = (await prisma.user.count()) === 0;
    const user = await prisma.user.create({
      data: {
        email,
        displayName: body.displayName,
        isAdmin: isFirstUser,
        passwordHash,
        argonSalt: body.argonSalt,
        encryptedPrivateKey: body.encryptedPrivateKey,
        recoverySalt: body.recoverySalt,
        recoveryEncryptedPrivateKey: body.recoveryEncryptedPrivateKey,
        recoveryKeyHash: storeRecoveryPhraseHash(body.recoveryKeyHash),
        publicKey: body.publicKey,
        signingPublicKey: body.signingPublicKey,
        totpSecretEncrypted: encryptSecret(totpSecret),
        totpEnabled: false,
        // Reserve backup hashes during setup; they are returned in plaintext
        // only after the first valid TOTP code at enable time.
        backupCodes: [],
        recoveryEmail: body.recoveryEmail ? normalizeEmail(body.recoveryEmail) : null,
        storageLimitBytes: maxStorageBytes(),
        folders: { create: SYSTEM_FOLDERS.map((folder) => ({ ...folder })) },
      },
      select: { id: true, email: true },
    });

    const setupToken = await signFlowToken({
      userId: user.id,
      purpose: "totp_setup",
      expiresIn: "30m",
    });
    const uri = totpUri(email, totpSecret);
    const qrDataUrl = await totpQrDataUrl(uri);
    return json(
      {
        setupToken,
        totpSecret,
        otpauthUri: uri,
        qrDataUrl,
        email,
        displayName: body.displayName,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  });
}
