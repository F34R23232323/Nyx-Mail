import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { contactCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { contactToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return safe(async () => {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().slice(0, 100) || "";
    const limit = Math.min(Number(searchParams.get("limit") || 30), 200);
    const contacts = await prisma.contact.findMany({
      where: {
        userId: auth.userId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: Number.isFinite(limit) ? limit : 30,
    });
    return json({ contacts: contacts.map(contactToDTO) });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, contactCreateSchema);
    const email = normalizeEmail(body.email);
    const existing = await prisma.contact.findFirst({
      where: { userId: auth.userId, dedupeKey: email },
    });
    if (existing) {
      const updated = body.name
        ? await prisma.contact.update({ where: { id: existing.id }, data: { name: body.name } })
        : existing;
      return json({ contact: contactToDTO(updated), existing: true });
    }
    const count = await prisma.contact.count({ where: { userId: auth.userId } });
    if (count >= 10000) throw new ApiError(400, "Contact limit reached", "contact_limit");
    const contact = await prisma.contact.create({
      data: {
        userId: auth.userId,
        email,
        dedupeKey: email,
        name: body.name || email.split("@")[0],
      },
    });
    return json({ contact: contactToDTO(contact) }, { status: 201 });
  });
}
