import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@nyxmail/db";
import { contactsToVCard, parseVCard } from "@nyxmail/shared";
import { requireAuth, requireUserOrRefresh } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { contactToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importSchema = z.object({ vcard: z.string().min(10).max(5_000_000) });

export async function GET(request: NextRequest) {
  return safe(async () => {
    const auth = await requireUserOrRefresh(request);
    const contacts = await prisma.contact.findMany({
      where: { userId: auth.userId },
      orderBy: { name: "asc" },
    });
    const body = contactsToVCard(contacts.map(contactToDTO));
    return new Response(body, {
      headers: {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": 'attachment; filename="nyxmail-contacts.vcf"',
        "Cache-Control": "private, no-store",
      },
    });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, importSchema);
    let parsed;
    try {
      parsed = parseVCard(body.vcard);
    } catch {
      throw new ApiError(400, "Could not parse the vCard file", "invalid_vcard");
    }
    if (parsed.length === 0) throw new ApiError(400, "No contacts found in the file", "invalid_vcard");
    if (parsed.length > 5000) throw new ApiError(400, "At most 5000 contacts can be imported at once", "too_many");
    const existing = await prisma.contact.findMany({
      where: { userId: auth.userId, dedupeKey: { in: parsed.map((contact) => contact.email) } },
      select: { id: true, dedupeKey: true },
    });
    const existingMap = new Map(existing.map((contact) => [contact.dedupeKey, contact.id]));
    let created = 0;
    let updated = 0;
    for (const contact of parsed) {
      const id = existingMap.get(contact.email);
      if (id) {
        await prisma.contact.update({
          where: { id },
          data: { name: contact.name || undefined },
        });
        updated += 1;
      } else {
        await prisma.contact.create({
          data: {
            userId: auth.userId,
            email: contact.email,
            dedupeKey: contact.email,
            name: contact.name || contact.email.split("@")[0],
          },
        });
        created += 1;
      }
    }
    return json({ ok: true, created, updated });
  });
}
