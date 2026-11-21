import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { contactToDTO } from "@/lib/serializers";
import { isEmail } from "@nyxmail/shared";

const updateSchema = z.object({
  name: z.string().trim().max(160).optional(),
  email: z.string().trim().max(320).refine((value) => isEmail(value), "Invalid email").optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const contact = await prisma.contact.findFirst({
      where: { id: context.params.id, userId: auth.userId },
    });
    if (!contact) throw new ApiError(404, "Contact not found", "not_found");
    const body = await parseBody(request, updateSchema);
    const email = body.email ? normalizeEmail(body.email) : contact.email;
    if (body.email && email !== contact.email) {
      const duplicate = await prisma.contact.findFirst({
        where: { userId: auth.userId, dedupeKey: email, id: { not: contact.id } },
        select: { id: true },
      });
      if (duplicate) throw new ApiError(409, "A contact with that email already exists", "contact_exists");
    }
    const updated = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        name: body.name ?? contact.name,
        email,
        dedupeKey: email,
      },
    });
    return json({ contact: contactToDTO(updated) });
  });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const contact = await prisma.contact.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      select: { id: true },
    });
    if (!contact) throw new ApiError(404, "Contact not found", "not_found");
    await prisma.contact.delete({ where: { id: contact.id } });
    return json({ ok: true });
  });
}
