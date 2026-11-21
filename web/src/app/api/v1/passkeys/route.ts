import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { webauthnRegisterVerifySchema } from "@/lib/validation";
import { storedCredentials, verifyRegistration } from "@/lib/webauthn";
import { verifyFlowToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { webauthnCredentials: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    return json({
      passkeys: storedCredentials(user).map((credential) => ({
        id: credential.id,
        name: credential.name ?? "Passkey",
        createdAt: credential.createdAt,
        deviceType: credential.deviceType ?? null,
        backedUp: Boolean(credential.backedUp),
      })),
    });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, webauthnRegisterVerifySchema);
    const { userId, data } = await verifyFlowToken(body.flowToken, "webauthn_register");
    if (userId !== auth.userId || typeof data.challenge !== "string") {
      throw new ApiError(401, "Passkey flow does not match this account", "invalid_flow");
    }
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    let verified;
    try {
      verified = await verifyRegistration(
        user,
        body.response as RegistrationResponseJSON,
        data.challenge,
        body.name,
      );
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : "Passkey registration failed",
        "passkey_failed",
      );
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { webauthnCredentials: verified.credentials as unknown as Prisma.InputJsonValue },
    });
    return json({
      ok: true,
      passkey: {
        id: verified.credential.id,
        name: verified.credential.name,
        createdAt: verified.credential.createdAt,
      },
    });
  });
}
