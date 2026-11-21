import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { labelUpdateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { labelToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const label = await prisma.label.findFirst({ where: { id: context.params.id, userId: auth.userId } });
    if (!label) throw new ApiError(404, "Label not found", "not_found");
    const body = await parseBody(request, labelUpdateSchema);
    if (body.name && body.name !== label.name) {
      const duplicate = await prisma.label.findFirst({
        where: { userId: auth.userId, name: body.name, id: { not: label.id } },
        select: { id: true },
      });
      if (duplicate) throw new ApiError(409, "A label with that name already exists", "label_exists");
    }
    const updated = await prisma.label.update({
      where: { id: label.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.color ? { color: body.color } : {}),
      },
    });
    return json({ label: labelToDTO(updated) });
  });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const label = await prisma.label.findFirst({ where: { id: context.params.id, userId: auth.userId } });
    if (!label) throw new ApiError(404, "Label not found", "not_found");
    await prisma.label.delete({ where: { id: label.id } });
    return json({ ok: true });
  });
}
