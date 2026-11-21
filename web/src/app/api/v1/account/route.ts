import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { accountUpdateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { loadUserDTO } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    return json({ user: await loadUserDTO(auth.userId) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function PATCH(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, accountUpdateSchema);
    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.recoveryEmail !== undefined) {
      data.recoveryEmail = body.recoveryEmail ? normalizeEmail(body.recoveryEmail) : null;
    }
    if (body.signatureText !== undefined) data.signatureText = body.signatureText;
    if (body.signatureHtml !== undefined) data.signatureHtml = body.signatureHtml;
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: auth.userId }, data });
    }
    return json({ user: await loadUserDTO(auth.userId) });
  });
}
