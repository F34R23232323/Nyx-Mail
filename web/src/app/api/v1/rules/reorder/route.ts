import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { mailRuleReorderSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, mailRuleReorderSchema);
    const owned = await prisma.mailRule.findMany({
      where: { userId: auth.userId, id: { in: body.ids } },
      select: { id: true },
    });
    if (owned.length !== body.ids.length) {
      throw new ApiError(400, "One or more rules do not belong to this account", "invalid_rules");
    }
    await prisma.$transaction(
      body.ids.map((id, index) =>
        prisma.mailRule.update({ where: { id }, data: { priority: index } }),
      ),
    );
    return json({ ok: true });
  });
}
