import type { NextRequest } from "next/server";
import { assertTrustedOrigin, json, safe } from "@/lib/http";
import { clearAuthCookies, requireAuth, revokeCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await revokeCurrentSession(auth.sessionId, auth.userId);
    const response = json({ ok: true });
    clearAuthCookies(response);
    return response;
  });
}
