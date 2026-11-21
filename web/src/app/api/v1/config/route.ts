import { signupHostedDomains } from "@nyxmail/server";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(
    {
      signupDomains: await signupHostedDomains(),
      signupEnabled: true,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
