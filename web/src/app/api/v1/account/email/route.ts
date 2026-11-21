import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { isHostedDomain } from "@nyxmail/server";
import { decryptSecret } from "@nyxmail/shared/secrets";
import { normalizeEmail } from "@nyxmail/shared";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { verifyPassword } from "@/lib/passwords";
import { consumeLimit } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import { loadUserDTO } from "@/lib/user";
import { accountEmailChangeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`email-change:${getClientIp(request)}:${auth.userId}`, 5, 15 * 60 * 1000);
    const body = await parseBody(request, accountEmailChangeSchema);
    const nextEmail = normalizeEmail(body.email);

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        totpEnabled: true,
        totpSecretEncrypted: true,
      },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (nextEmail === user.email) {
      throw new ApiError(400, "That is already your primary address", "same_email");
    }
    const domain = nextEmail.split("@").pop() || "";
    if (!(await isHostedDomain(domain))) {
      throw new ApiError(400, `@${domain || "that domain"} is not configured for this server`, "invalid_domain");
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      throw new ApiError(403, "Current password is incorrect", "invalid_password");
    }
    if (!user.totpEnabled || !user.totpSecretEncrypted) {
      throw new ApiError(400, "Two-factor authentication is not enabled", "totp_required");
    }
    let totpSecret: string;
    try {
      totpSecret = decryptSecret(user.totpSecretEncrypted);
    } catch {
      throw new ApiError(500, "Could not read the authenticator secret", "totp_error");
    }
    if (!verifyTotp(body.code, totpSecret)) {
      throw new ApiError(403, "Authenticator code is incorrect", "invalid_code");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: nextEmail },
      select: { id: true },
    });
    if (existingUser) {
      throw new ApiError(409, "That address already belongs to an account", "email_taken");
    }
    const nextAlias = await prisma.alias.findUnique({
      where: { address: nextEmail },
      select: { id: true, userId: true },
    });
    if (nextAlias && nextAlias.userId !== user.id) {
      throw new ApiError(409, "That address is already an alias on another account", "email_taken");
    }

    const oldAlias = await prisma.alias.findUnique({
      where: { address: user.email },
      select: { id: true },
    });
    const aliasCount = await prisma.alias.count({ where: { userId: user.id } });
    const preserveOld = !oldAlias && aliasCount < 10;

    const updated = await prisma.$transaction(async (tx) => {
      if (nextAlias && nextAlias.userId === user.id) {
        await tx.alias.delete({ where: { id: nextAlias.id } });
      }
      if (preserveOld) {
        await tx.alias.create({ data: { userId: user.id, address: user.email } });
      }
      const result = await tx.user.update({
        where: { id: user.id },
        data: { email: nextEmail },
        select: { id: true },
      });
      // A primary-address change is security-sensitive. Keep this session,
      // revoke other devices so they must authenticate again.
      await tx.session.updateMany({
        where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return result;
    });

    return json({
      user: await loadUserDTO(updated.id),
      oldEmailAlias: preserveOld,
    });
  });
}
