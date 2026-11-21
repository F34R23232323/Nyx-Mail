import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { verifyRecoveryPhraseHash } from "@nyxmail/shared/secrets";
import { normalizeEmail } from "@nyxmail/shared";
import { recoveryCompleteSchema } from "@/lib/validation";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { hashPassword, passwordLooksAcceptable } from "@/lib/passwords";
import { isArgonSalt, isEncryptedKeyEnvelope } from "@/lib/key-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, recoveryCompleteSchema);
    const email = normalizeEmail(body.email);
    await consumeLimit(limiterKeys(ip).recovery(email), 8, 15 * 60 * 1000, "Too many recovery attempts");

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, recoveryKeyHash: true },
    });
    if (!user || !verifyRecoveryPhraseHash(body.phraseHash, user.recoveryKeyHash)) {
      throw new ApiError(403, "Recovery could not be completed", "invalid_recovery");
    }
    const passwordError = passwordLooksAcceptable(body.newPassword, email);
    if (passwordError) throw new ApiError(400, passwordError, "weak_password");
    if (!isEncryptedKeyEnvelope(body.encryptedPrivateKey) || !isArgonSalt(body.argonSalt)) {
      throw new ApiError(400, "Invalid encrypted key envelope", "invalid_keys");
    }

    const passwordHash = await hashPassword(body.newPassword);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          argonSalt: body.argonSalt,
          encryptedPrivateKey: body.encryptedPrivateKey,
        },
      }),
      prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
