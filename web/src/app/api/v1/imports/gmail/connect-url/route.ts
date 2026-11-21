import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, safe } from "@/lib/http";
import { buildGmailAuthUrl, isGmailConfigured } from "@/lib/gmail";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a Google consent URL for the native "From Gmail" flow. The app opens
 * it in a secure browser session and waits for nyxmail://gmail-connected.
 * Checking the session happens here, where the app can send its cookies; the
 * browser never needs to be signed in to NyxMail.
 */
export async function GET(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    if (!isGmailConfigured()) {
      throw new ApiError(503, "Gmail is not configured on this server", "gmail_unconfigured");
    }
    const auth = await requireAuth();
    await consumeLimit(`gmail-connect:${auth.userId}`, 10, 15 * 60 * 1000);
    const url = await buildGmailAuthUrl(auth.userId, { mobile: true });
    return json({ url }, { headers: { "Cache-Control": "no-store" } });
  });
}
