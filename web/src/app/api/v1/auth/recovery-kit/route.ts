import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@nyxmail/db";
import { decryptSecret, storeRecoveryPhraseHash } from "@nyxmail/shared/secrets";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { verifyPassword } from "@/lib/passwords";
import { verifyTotp } from "@/lib/totp";
import { isArgonSalt, isEncryptedKeyEnvelope } from "@/lib/key-validation";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  code: z.string().trim().min(6).max(8),
  recoveryEncryptedPrivateKey: z.string().min(50).max(200_000),
  recoverySalt: z.string().min(10).max(100),
  recoveryKeyHash: z.string().length(64),
});

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(limiterKeys(getClientIp(request)).verify(auth.userId), 6, 15 * 60 * 1000);
    const body = await parseBody(request, schema);
    if (!isEncryptedKeyEnvelope(body.recoveryEncryptedPrivateKey) || !isArgonSalt(body.recoverySalt)) {
      throw new ApiError(400, "Invalid recovery envelope", "invalid_keys");
    }
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { passwordHash: true, totpEnabled: true, totpSecretEncrypted: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new ApiError(403, "Password is incorrect", "invalid_password");
    }
    if (!user.totpEnabled || !user.totpSecretEncrypted) {
      throw new ApiError(400, "Two-factor authentication must be enabled", "totp_required");
    }
    if (!verifyTotp(body.code, decryptSecret(user.totpSecretEncrypted))) {
      throw new ApiError(401, "Invalid authentication code", "invalid_code");
    }
    await prisma.user.update({
      where: { id: auth.userId },
      data: {
        recoveryEncryptedPrivateKey: body.recoveryEncryptedPrivateKey,
        recoverySalt: body.recoverySalt,
        recoveryKeyHash: storeRecoveryPhraseHash(body.recoveryKeyHash),
      },
    });
    return json({ ok: true });
  });
}
