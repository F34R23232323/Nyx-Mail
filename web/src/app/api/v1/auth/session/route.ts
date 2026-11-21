import { cookies } from "next/headers";
import { requireAuth, CSRF_COOKIE } from "@/lib/auth";
import { json, safe } from "@/lib/http";
import { loadUserDTO } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const user = await loadUserDTO(auth.userId);
    return json(
      {
        user,
        csrfToken: cookies().get(CSRF_COOKIE)?.value ?? null,
        serverTime: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
