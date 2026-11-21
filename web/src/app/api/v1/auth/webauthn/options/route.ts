import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { webauthnAuthOptionsSchema } from "@/lib/validation";
import { signFlowToken, verifyFlowToken } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import { buildAuthenticationOptions } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, webauthnAuthOptionsSchema);
    const { userId } = await verifyFlowToken(body.mfaToken, "mfa");
    await consumeLimit(limiterKeys(ip).verify(userId), 20, 10 * 60 * 1000);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, webauthnCredentials: true, totpEnabled: true },
    });
    if (!user || !user.totpEnabled) throw new ApiError(401, "Account not available", "invalid_flow");
    const options = await buildAuthenticationOptions(user).catch(() => {
      throw new ApiError(400, "No passkeys are registered", "no_passkeys");
    });
    const flowToken = await signFlowToken({
      userId,
      purpose: "webauthn_auth",
      data: { challenge: options.challenge },
      expiresIn: "5m",
    });
    return json({ options, flowToken }, { headers: { "Cache-Control": "no-store" } });
  });
}
