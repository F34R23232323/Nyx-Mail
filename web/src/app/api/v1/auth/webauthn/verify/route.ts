import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { webauthnAuthVerifySchema } from "@/lib/validation";
import {
  applySessionCookies,
  createSession,
  signFlowToken,
  verifyFlowToken,
} from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { consumeLimit, limiterKeys } from "@/lib/rate-limit";
import {
  storedCredentials,
  updateCredentialCounter,
  verifyAuthentication,
} from "@/lib/webauthn";
import { loadUserDTO } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const ip = getClientIp(request);
    const body = await parseBody(request, webauthnAuthVerifySchema);
    const mfa = await verifyFlowToken(body.mfaToken, "mfa");
    const flow = await verifyFlowToken(body.flowToken, "webauthn_auth");
    if (mfa.userId !== flow.userId || typeof flow.data.challenge !== "string") {
      throw new ApiError(401, "Passkey flow mismatch", "invalid_flow");
    }
    await consumeLimit(limiterKeys(ip).verify(mfa.userId), 12, 10 * 60 * 1000);
    const user = await prisma.user.findUnique({ where: { id: mfa.userId } });
    if (!user || !user.totpEnabled) throw new ApiError(401, "Account not available", "invalid_flow");
    let verification;
    try {
      verification = await verifyAuthentication(
        user,
        body.response as AuthenticationResponseJSON,
        flow.data.challenge,
      );
    } catch (error) {
      throw new ApiError(
        401,
        error instanceof Error ? error.message : "Passkey verification failed",
        "passkey_failed",
      );
    }
    const updated = updateCredentialCounter(
      storedCredentials(user),
      verification.credential.id,
      verification.newCounter,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { webauthnCredentials: updated as unknown as Prisma.InputJsonValue },
    });
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
