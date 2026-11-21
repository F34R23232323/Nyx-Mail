import { buildDnsSetupFromDatabase } from "@nyxmail/server";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    await requireAuth();
    return json(await buildDnsSetupFromDatabase(), { headers: { "Cache-Control": "no-store" } });
  });
}
