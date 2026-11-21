import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { decryptSecret } from "@nyxmail/shared/secrets";
import { generateBackupCodes } from "@nyxmail/crypto";
import { enableTwoFactorSchema } from "@/lib/validation";
import { applySessionCookies, createSession, verifyFlowToken } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import { loadUserDTO } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, enableTwoFactorSchema);
    const { userId } = await verifyFlowToken(body.setupToken, "totp_setup");
    await consumeLimit(limiterKeys(ip).verify(userId), 12, 10 * 60 * 1000, "Too many codes. Try again later.");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, totpEnabled: true, totpSecretEncrypted: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (user.totpEnabled) throw new ApiError(409, "Two-factor authentication is already enabled", "already_enabled");
    if (!user.totpSecretEncrypted) throw new ApiError(500, "Missing TOTP secret", "setup_broken");

    const secret = decryptSecret(user.totpSecretEncrypted);
    if (!verifyTotp(body.code, secret)) {
      throw new ApiError(401, "That code is not valid. Check your device clock and try again.", "invalid_code");
    }
    const backupCodes = await generateBackupCodes(10);
    await prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        backupCodes: backupCodes.hashes as Prisma.InputJsonValue,
      },
    });
    const tokens = await createSession(userId, request);
    const dto = await loadUserDTO(userId);
    const response = json(
      { user: dto, backupCodes: backupCodes.plain, csrfToken: tokens.csrfToken },
      { headers: { "Cache-Control": "no-store" } },
    );
    applySessionCookies(response, tokens);
    return response;
  });
}
