import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { decryptSecret } from "@nyxmail/shared/secrets";
import { verifySchema } from "@/lib/validation";
import { applySessionCookies, createSession, verifyFlowToken } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { consumeBackupCode, verifyTotp } from "@/lib/totp";
import { loadUserDTO } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, verifySchema);
    const { userId, data } = await verifyFlowToken(body.mfaToken, "mfa");
    const methods = Array.isArray(data.methods) ? data.methods : [];
    await consumeLimit(limiterKeys(ip).verify(userId), 12, 10 * 60 * 1000, "Too many codes. Try again later.");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        totpEnabled: true,
        totpSecretEncrypted: true,
        backupCodes: true,
      },
    });
    if (!user || !user.totpEnabled || !user.totpSecretEncrypted) {
      throw new ApiError(401, "Two-factor authentication is not available", "invalid_flow");
    }
    if (!methods.includes(body.method)) {
      throw new ApiError(400, "That verification method is not available", "method_unavailable");
    }

    if (body.method === "totp") {
      const secret = decryptSecret(user.totpSecretEncrypted);
      if (!verifyTotp(body.code, secret)) {
        throw new ApiError(401, "Invalid authentication code", "invalid_code");
      }
    } else {
      const result = await consumeBackupCode(user.backupCodes, body.code);
      if (!result.ok) throw new ApiError(401, "Invalid backup code", "invalid_code");
      const updated = await prisma.user.updateMany({
        where: { id: user.id },
        data: { backupCodes: result.remainingHashes as Prisma.InputJsonValue },
      });
      if (updated.count === 0) {
        throw new ApiError(409, "That backup code was already used. Try another one.", "code_used");
      }
    }

    const tokens = await createSession(user.id, request);
    const dto = await loadUserDTO(user.id);
    const response = json(
      { user: dto, csrfToken: tokens.csrfToken },
      { headers: { "Cache-Control": "no-store" } },
    );
    applySessionCookies(response, tokens);
    return response;
  });
}
