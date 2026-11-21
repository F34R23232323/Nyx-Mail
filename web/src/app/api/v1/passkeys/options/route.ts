import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { requireAuth, signFlowToken } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";
import { buildRegistrationOptions } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`passkey:${getClientIp(request)}:${auth.userId}`, 20, 10 * 60 * 1000);
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    const options = await buildRegistrationOptions(user);
    const flowToken = await signFlowToken({
      userId: user.id,
      purpose: "webauthn_register",
      data: { challenge: options.challenge },
      expiresIn: "5m",
    });
    return json({ options, flowToken }, { headers: { "Cache-Control": "no-store" } });
  });
}
