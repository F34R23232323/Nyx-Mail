import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";
import { unreadMessageWhere } from "@/lib/unread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const unread = await prisma.message.count({
      where: {
        ...unreadMessageWhere(auth.userId),
        folder: { type: "INBOX" },
      },
    });
    return json({ unread }, { headers: { "Cache-Control": "no-store" } });
  });
}
