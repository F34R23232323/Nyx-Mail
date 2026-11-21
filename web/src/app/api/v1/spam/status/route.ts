import type { NextRequest } from "next/server";
import { rspamdStatus } from "@nyxmail/server";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return safe(async () => {
    await requireAuth(request);
    return json(await rspamdStatus());
  });
}
