import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { decryptSecret } from "@nyxmail/shared/secrets";
import { setupTokenSchema } from "@/lib/validation";
import { verifyFlowToken } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";
import { totpQrDataUrl, totpUri } from "@/lib/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    await consumeLimit(`totp-setup:${getClientIp(request)}`, 30, 15 * 60 * 1000);
    const body = await parseBody(request, setupTokenSchema);
    const { userId } = await verifyFlowToken(body.setupToken, "totp_setup");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, totpEnabled: true, totpSecretEncrypted: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (user.totpEnabled) throw new ApiError(409, "Two-factor authentication is already enabled", "already_enabled");
    if (!user.totpSecretEncrypted) throw new ApiError(500, "Missing TOTP secret");
    const secret = decryptSecret(user.totpSecretEncrypted);
    const uri = totpUri(user.email, secret);
    return json(
      {
        totpSecret: secret,
        otpauthUri: uri,
        qrDataUrl: await totpQrDataUrl(uri),
        email: user.email,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
