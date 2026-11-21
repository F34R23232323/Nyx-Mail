import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { decryptSecret } from "@nyxmail/shared/secrets";
import { generateBackupCodes } from "@nyxmail/crypto";
import { regenerateBackupCodesSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { verifyTotp } from "@/lib/totp";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(limiterKeys(getClientIp(request)).verify(auth.userId), 12, 10 * 60 * 1000);
    const body = await parseBody(request, regenerateBackupCodesSchema);
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { totpEnabled: true, totpSecretEncrypted: true },
    });
    if (!user?.totpEnabled || !user.totpSecretEncrypted) {
      throw new ApiError(400, "Two-factor authentication must be enabled", "totp_required");
    }
    if (!verifyTotp(body.code, decryptSecret(user.totpSecretEncrypted))) {
      throw new ApiError(401, "Invalid authentication code", "invalid_code");
    }
    const codes = await generateBackupCodes(10);
    await prisma.user.update({
      where: { id: auth.userId },
      data: { backupCodes: codes.hashes as Prisma.InputJsonValue },
    });
    return json({ backupCodes: codes.plain, remaining: codes.plain.length });
  });
}
