import { buildDnsSetupFromDatabase, checkDnsSetup } from "@nyxmail/server";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    await consumeLimit(`dns-status:${auth.userId}`, 30, 60_000);
    const setup = await buildDnsSetupFromDatabase();
    const result = await checkDnsSetup(setup);
    return json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
