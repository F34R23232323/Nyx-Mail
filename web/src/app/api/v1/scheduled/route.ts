import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const jobs = await prisma.scheduledSend.findMany({
      where: { userId: auth.userId, status: "PENDING" },
      orderBy: { sendAt: "asc" },
      select: { id: true, sendAt: true, status: true, createdAt: true },
    });
    return json({
      scheduled: jobs.map((job) => ({
        id: job.id,
        sendAt: job.sendAt.toISOString(),
        status: job.status,
        createdAt: job.createdAt.toISOString(),
      })),
    });
  });
}
