import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { importActionSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { importToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, importActionSchema);
    const job = await prisma.importJob.findFirst({
      where: { id: context.params.id, userId: auth.userId },
    });
    if (!job) throw new ApiError(404, "Import job not found", "not_found");
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
      throw new ApiError(400, "This import has already finished", "import_finished");
    }
    if (body.action === "cancel") {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
    } else if (body.action === "pause") {
      if (!["PENDING", "RUNNING"].includes(job.status)) {
        throw new ApiError(400, "Only pending or running imports can be paused", "invalid_state");
      }
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "PAUSED" } });
    } else {
      if (job.status !== "PAUSED") {
        throw new ApiError(400, "Only paused imports can be resumed", "invalid_state");
      }
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "PENDING" } });
    }
    const updated = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    return json({ import: importToDTO(updated) });
  });
}
