import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const accounts = await prisma.gmailAccount.findMany({
      where: { userId: auth.userId },
      select: {
        id: true,
        googleEmail: true,
        enabled: true,
        lastSyncAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return json({ accounts }, { headers: { "Cache-Control": "no-store" } });
  });
}
