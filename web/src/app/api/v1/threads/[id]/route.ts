import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma, type Prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { messageToDTO } from "@/lib/serializers";
import { getFolderByType, getOwnedFolder } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    const auth = await requireAuth();
    const thread = await prisma.thread.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      include: {
        messages: {
          orderBy: { sentAt: "asc" },
          take: 500,
          include: { folder: true, labels: true, attachmentRows: true },
        },
      },
    });
    if (!thread) throw new ApiError(404, "Conversation not found", "not_found");
    return json({
      thread: {
        id: thread.id,
        lastActivityAt: thread.lastActivityAt.toISOString(),
        messageCount: thread.messageCount,
      },
      messages: thread.messages.map(messageToDTO),
    });
  });
}

const threadActionSchema = z.object({
  action: z.enum([
    "read",
    "unread",
    "star",
    "unstar",
    "archive",
    "trash",
    "spam",
    "notSpam",
    "inbox",
    "move",
    "snooze",
  ]),
  folderId: z.string().cuid().optional(),
  snoozeUntil: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, threadActionSchema);
    const thread = await prisma.thread.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      select: { id: true },
    });
    if (!thread) throw new ApiError(404, "Conversation not found", "not_found");
    const where = { userId: auth.userId, threadId: thread.id };
    let data: Prisma.MessageUncheckedUpdateManyInput = {};
    switch (body.action) {
      case "read":
        data = { isRead: true };
        break;
      case "unread":
        data = { isRead: false };
        break;
      case "star":
        data = { isStarred: true };
        break;
      case "unstar":
        data = { isStarred: false };
        break;
      case "archive": {
        const folder = await getFolderByType(auth.userId, "ARCHIVE");
        data = { folderId: folder.id, trashedAt: null, purgeAt: null };
        break;
      }
      case "inbox":
      case "notSpam": {
        const folder = await getFolderByType(auth.userId, "INBOX");
        data = { folderId: folder.id, trashedAt: null, purgeAt: null };
        break;
      }
      case "trash": {
        const folder = await getFolderByType(auth.userId, "TRASH");
        data = {
          folderId: folder.id,
          trashedAt: new Date(),
          purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };
        break;
      }
      case "spam": {
        const folder = await getFolderByType(auth.userId, "SPAM");
        data = { folderId: folder.id, trashedAt: null, purgeAt: null };
        break;
      }
      case "move": {
        if (!body.folderId) throw new ApiError(400, "A destination folder is required", "missing_folder");
        const folder = await getOwnedFolder(auth.userId, body.folderId);
        data = {
          folderId: folder.id,
          trashedAt: folder.type === "TRASH" ? new Date() : null,
          purgeAt: folder.type === "TRASH" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
        };
        break;
      }
      case "snooze": {
        if (body.snoozeUntil) {
          const until = new Date(body.snoozeUntil);
          if (Number.isNaN(until.getTime()) || until <= new Date()) {
            throw new ApiError(400, "Snooze date must be in the future", "invalid_snooze");
          }
          data = { snoozeUntil: until };
        } else {
          data = { snoozeUntil: null };
        }
        break;
      }
    }
    const result = await prisma.message.updateMany({ where, data });
    await prisma.thread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });
    return json({ updated: result.count });
  });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const thread = await prisma.thread.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      select: { id: true },
    });
    if (!thread) throw new ApiError(404, "Conversation not found", "not_found");
    const folder = await getFolderByType(auth.userId, "TRASH");
    await prisma.message.updateMany({
      where: { userId: auth.userId, threadId: thread.id },
      data: {
        folderId: folder.id,
        trashedAt: new Date(),
        purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return json({ ok: true });
  });
}
