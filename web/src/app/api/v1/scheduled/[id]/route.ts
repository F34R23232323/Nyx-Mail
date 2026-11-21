import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const job = await prisma.scheduledSend.findFirst({
      where: { id: context.params.id, userId: auth.userId, status: "PENDING" },
      select: { id: true },
    });
    if (!job) throw new ApiError(404, "Scheduled message not found", "not_found");
    await prisma.scheduledSend.update({
      where: { id: job.id },
      data: { status: "CANCELLED" },
    });
    return json({ ok: true });
  });
}
