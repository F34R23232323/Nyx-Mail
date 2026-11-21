import type { NextRequest } from "next/server";
import { applySessionCookies, clearAuthCookies, rotateRefreshToken } from "@/lib/auth";
import { assertTrustedOrigin, getClientIp, json, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";
import { loadUserDTO } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    await consumeLimit(`refresh:${getClientIp(request)}`, 120, 5 * 60 * 1000);
    try {
      const { userId, tokens } = await rotateRefreshToken();
      const user = await loadUserDTO(userId);
      const response = json(
        { user, csrfToken: tokens.csrfToken },
        { headers: { "Cache-Control": "no-store" } },
      );
      applySessionCookies(response, tokens);
      return response;
    } catch {
      const response = json(
        { error: "Session expired. Please sign in again.", code: "session_expired" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
      clearAuthCookies(response);
      return response;
    }
  });
}
