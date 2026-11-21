import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, safe } from "@/lib/http";
import { storedCredentials } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { webauthnCredentials: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    const credentials = storedCredentials(user);
    if (!credentials.some((credential) => credential.id === context.params.id)) {
      throw new ApiError(404, "Passkey not found", "not_found");
    }
    await prisma.user.update({
      where: { id: auth.userId },
      data: {
        webauthnCredentials: credentials.filter(
          (credential) => credential.id !== context.params.id,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    return json({ ok: true });
  });
}
