import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { changePasswordSchema } from "@/lib/validation";
import { assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { ApiError } from "@/lib/http";
import { requireAuth } from "@/lib/auth";
import { hashPassword, passwordLooksAcceptable, verifyPassword } from "@/lib/passwords";
import { isArgonSalt, isEncryptedKeyEnvelope } from "@/lib/key-validation";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(limiterKeys(getClientIp(request)).verify(auth.userId), 10, 15 * 60 * 1000);
    const body = await parseBody(request, changePasswordSchema);
    if (!isEncryptedKeyEnvelope(body.encryptedPrivateKey) || !isArgonSalt(body.argonSalt)) {
      throw new ApiError(400, "Invalid encrypted key envelope", "invalid_keys");
    }
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { passwordHash: true, email: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new ApiError(403, "Current password is incorrect", "invalid_password");
    }
    const passwordError = passwordLooksAcceptable(body.newPassword, user.email);
    if (passwordError) throw new ApiError(400, passwordError, "weak_password");

    const passwordHash = await hashPassword(body.newPassword);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: auth.userId },
        data: {
          passwordHash,
          argonSalt: body.argonSalt,
          encryptedPrivateKey: body.encryptedPrivateKey,
        },
      }),
      prisma.session.updateMany({
        where: { userId: auth.userId, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return json({ ok: true });
  });
}
