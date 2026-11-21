import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";
import { sessionToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const sessions = await prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    });
    return json({ sessions: sessions.map((session) => sessionToDTO(session, auth.sessionId)) });
  });
}
