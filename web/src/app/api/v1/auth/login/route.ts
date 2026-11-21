import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { loginSchema } from "@/lib/validation";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { signFlowToken } from "@/lib/auth";
import { verifyPassword } from "@/lib/passwords";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { storedCredentials } from "@/lib/webauthn";
import { decryptSecret } from "@nyxmail/shared/secrets";
import { totpQrDataUrl, totpUri } from "@/lib/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$gJN5mFeyNAKzlSgeGSwZ9A$Plpa/h1bkhbxYs/mWcPJ1ojmtyQgIfM53xgEiCgI5oU";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, loginSchema);
    const email = normalizeEmail(body.email);
    const keys = limiterKeys(ip);
    await consumeLimit(keys.loginIp(), 30, 15 * 60 * 1000);
    await consumeLimit(keys.login(email), 8, 15 * 60 * 1000, "Too many sign-in attempts");

    const user = await prisma.user.findUnique({ where: { email }, include: { aliases: true } });
    const matchedUser =
      user ??
      (
        await prisma.user.findFirst({
          where: { aliases: { some: { address: email, active: true } } },
        })
      );
    if (!matchedUser) {
      await verifyPassword(DUMMY_HASH, body.password);
      throw new ApiError(401, "Invalid email or password", "invalid_credentials");
    }
    const valid = await verifyPassword(matchedUser.passwordHash, body.password);
    if (!valid) throw new ApiError(401, "Invalid email or password", "invalid_credentials");

    if (!matchedUser.totpEnabled) {
      const secret = matchedUser.totpSecretEncrypted
        ? decryptSecret(matchedUser.totpSecretEncrypted)
        : null;
      if (!secret) throw new ApiError(500, "Two-factor setup is incomplete", "setup_broken");
      const setupToken = await signFlowToken({
        userId: matchedUser.id,
        purpose: "totp_setup",
        expiresIn: "30m",
      });
      const uri = totpUri(matchedUser.email, secret);
      return json(
        {
          requiresSetup: true,
          setupToken,
          otpauthUri: uri,
          qrDataUrl: await totpQrDataUrl(uri),
          email: matchedUser.email,
          displayName: matchedUser.displayName,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const passkeys = storedCredentials(matchedUser).length;
    const methods = ["totp", "backup", ...(passkeys > 0 ? ["webauthn"] : [])];
    const mfaToken = await signFlowToken({
      userId: matchedUser.id,
      purpose: "mfa",
      data: { methods },
      expiresIn: "10m",
    });
    return json(
      {
        mfaRequired: true,
        mfaToken,
        methods,
        hasPasskeys: passkeys > 0,
        email: matchedUser.email,
        displayName: matchedUser.displayName,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
