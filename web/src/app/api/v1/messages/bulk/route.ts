import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { bulkSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { getFolderByType, getOwnedFolder } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, bulkSchema);
    const messages = await prisma.message.findMany({
      where: { userId: auth.userId, id: { in: body.ids } },
      select: { id: true },
    });
    const ids = messages.map((message) => message.id);
    if (ids.length === 0) return json({ updated: 0 });
    const where = { userId: auth.userId, id: { in: ids } };

    switch (body.action) {
      case "read":
        await prisma.message.updateMany({ where, data: { isRead: true } });
        break;
      case "unread":
        await prisma.message.updateMany({ where, data: { isRead: false } });
        break;
      case "star":
        await prisma.message.updateMany({ where, data: { isStarred: true } });
        break;
      case "unstar":
        await prisma.message.updateMany({ where, data: { isStarred: false } });
        break;
      case "archive": {
        const archive = await getFolderByType(auth.userId, "ARCHIVE");
        await prisma.message.updateMany({
          where,
          data: { folderId: archive.id, trashedAt: null, purgeAt: null },
        });
        break;
      }
      case "trash": {
        const trash = await getFolderByType(auth.userId, "TRASH");
        await prisma.message.updateMany({
          where,
          data: {
            folderId: trash.id,
            trashedAt: new Date(),
            purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        break;
      }
      case "spam": {
        const spam = await getFolderByType(auth.userId, "SPAM");
        await prisma.message.updateMany({
          where,
          data: { folderId: spam.id, trashedAt: null, purgeAt: null },
        });
        break;
      }
      case "delete": {
        const trash = await getFolderByType(auth.userId, "TRASH");
        await prisma.message.updateMany({
          where,
          data: {
            folderId: trash.id,
            trashedAt: new Date(),
            purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        break;
      }
      case "move": {
        if (!body.folderId) throw new ApiError(400, "A destination folder is required", "missing_folder");
        const target = await getOwnedFolder(auth.userId, body.folderId);
        await prisma.message.updateMany({
          where,
          data: {
            folderId: target.id,
            trashedAt: target.type === "TRASH" ? new Date() : null,
            purgeAt: target.type === "TRASH" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
          },
        });
        break;
      }
    }
    return json({ updated: ids.length, action: body.action });
  });
}
