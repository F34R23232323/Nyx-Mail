import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { verifyRecoveryPhraseHash } from "@nyxmail/shared/secrets";
import { normalizeEmail } from "@nyxmail/shared";
import { recoveryStartSchema } from "@/lib/validation";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, recoveryStartSchema);
    const email = normalizeEmail(body.email);
    await consumeLimit(limiterKeys(ip).recovery(email), 5, 15 * 60 * 1000, "Too many recovery attempts");

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        recoverySalt: true,
        recoveryEncryptedPrivateKey: true,
        recoveryKeyHash: true,
        email: true,
      },
    });
    const dummy = "0".repeat(64);
    const valid =
      user && /^[a-f0-9]{64}$/.test(body.phraseHash)
        ? verifyRecoveryPhraseHash(body.phraseHash, user.recoveryKeyHash)
        : verifyRecoveryPhraseHash(dummy, dummy);
    if (!user || !valid) {
      throw new ApiError(403, "That recovery phrase does not match this account", "invalid_recovery");
    }
    return json(
      {
        email: user.email,
        recoverySalt: user.recoverySalt,
        recoveryEncryptedPrivateKey: user.recoveryEncryptedPrivateKey,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
