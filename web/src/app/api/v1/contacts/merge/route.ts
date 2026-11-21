import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { contactMergeSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, contactMergeSchema);
    const contacts = await prisma.contact.findMany({
      where: { userId: auth.userId, id: { in: body.ids } },
      orderBy: { createdAt: "asc" },
    });
    if (contacts.length < 2) throw new ApiError(400, "Select at least two contacts to merge", "invalid_merge");
    const groups = new Map<string, typeof contacts>();
    for (const contact of contacts) {
      const group = groups.get(contact.dedupeKey) ?? [];
      group.push(contact);
      groups.set(contact.dedupeKey, group);
    }
    let merged = 0;
    for (const [dedupeKey, group] of groups) {
      if (group.length < 2) continue;
      const primary = group[0];
      const name = body.name || group.map((contact) => contact.name).find(Boolean) || dedupeKey;
      await prisma.contact.update({
        where: { id: primary.id },
        data: { name: name.slice(0, 160) },
      });
      await prisma.contact.deleteMany({
        where: { userId: auth.userId, id: { in: group.slice(1).map((contact) => contact.id) } },
      });
      merged += group.length - 1;
    }
    return json({ ok: true, merged });
  });
}
