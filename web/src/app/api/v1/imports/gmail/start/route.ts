import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ApiError, getClientIp, safe } from "@/lib/http";
import { buildGmailAuthUrl, isGmailConfigured } from "@/lib/gmail";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return safe(async () => {
    if (!isGmailConfigured()) {
      throw new ApiError(503, "Gmail import is not configured on this server", "gmail_unconfigured");
    }
    const auth = await requireAuth();
    await consumeLimit(`gmail-start:${getClientIp(request)}:${auth.userId}`, 10, 15 * 60 * 1000);
    const url = await buildGmailAuthUrl(auth.userId);
    return NextResponse.redirect(url);
  });
}
