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
    const session = await prisma.session.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      select: { id: true },
    });
    if (!session) throw new ApiError(404, "Session not found", "not_found");
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return json({ ok: true, current: session.id === auth.sessionId });
  });
}
