import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { messagePatchSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { getOwnedFolder } from "@/lib/folders";
import { messageToDTO } from "@/lib/serializers";
import { deleteUpload } from "@nyxmail/shared/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const include = { folder: true, labels: true, attachmentRows: true } as const;

async function refreshOrDeleteThread(threadId: string): Promise<void> {
  const count = await prisma.message.count({ where: { threadId } });
  if (count === 0) {
    await prisma.thread.deleteMany({ where: { id: threadId } });
  } else {
    const latest = await prisma.message.findFirst({
      where: { threadId },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    await prisma.thread.update({
      where: { id: threadId },
      data: { messageCount: count, lastActivityAt: latest?.sentAt ?? new Date() },
    });
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, messagePatchSchema);
    const message = await prisma.message.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      include: { folder: true },
    });
    if (!message) throw new ApiError(404, "Message not found", "not_found");

    const data: Prisma.MessageUpdateInput = {};
    if (body.isRead !== undefined) data.isRead = body.isRead;
    if (body.isStarred !== undefined) data.isStarred = body.isStarred;
    if (body.folderId !== undefined) {
      const target = await getOwnedFolder(auth.userId, body.folderId);
      data.folder = { connect: { id: target.id } };
      if (target.type === "TRASH") {
        data.trashedAt = new Date();
        data.purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else {
        data.trashedAt = null;
        data.purgeAt = null;
      }
    }
    if (body.snoozeUntil !== undefined) {
      if (body.snoozeUntil) {
        const until = new Date(body.snoozeUntil);
        if (Number.isNaN(until.getTime()) || until <= new Date()) {
          throw new ApiError(400, "Snooze date must be in the future", "invalid_snooze");
        }
        data.snoozeUntil = until;
      } else {
        data.snoozeUntil = null;
      }
    }
    if (body.labelIds) {
      const labels = await prisma.label.findMany({
        where: { userId: auth.userId, id: { in: body.labelIds } },
        select: { id: true },
      });
      data.labels = { set: labels.map((label) => ({ id: label.id })) };
    } else {
      if (body.addLabelIds?.length) {
        const labels = await prisma.label.findMany({
          where: { userId: auth.userId, id: { in: body.addLabelIds } },
          select: { id: true },
        });
        data.labels = { connect: labels.map((label) => ({ id: label.id })) };
      }
      if (body.removeLabelIds?.length) {
        data.labels = {
          ...(data.labels as object),
          disconnect: body.removeLabelIds.map((id) => ({ id })),
        } as Prisma.MessageUpdateInput["labels"];
      }
    }

    const updated = await prisma.message.update({
      where: { id: message.id },
      data,
      include,
    });
    return json({ message: messageToDTO(updated) });
  });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const permanent = new URL(request.url).searchParams.get("permanent") === "true";
    const message = await prisma.message.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      include: { folder: true, attachmentRows: true },
    });
    if (!message) throw new ApiError(404, "Message not found", "not_found");

    if (!permanent && message.folder.type !== "TRASH") {
      const trash = await prisma.folder.findFirst({
        where: { userId: auth.userId, type: "TRASH" },
        select: { id: true },
      });
      if (!trash) throw new ApiError(500, "Trash folder unavailable");
      const updated = await prisma.message.update({
        where: { id: message.id },
        data: {
          folderId: trash.id,
          trashedAt: new Date(),
          purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        include,
      });
      return json({ message: messageToDTO(updated), trashed: true });
    }

    const attachmentPaths = message.attachmentRows.map((attachment) => attachment.storagePath);
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: auth.userId },
        select: { storageUsedBytes: true },
      });
      await tx.message.delete({ where: { id: message.id } });
      await tx.user.update({
        where: { id: auth.userId },
        data: { storageUsedBytes: Math.max(0, (current?.storageUsedBytes ?? 0) - message.sizeBytes) },
      });
    });
    for (const storagePath of new Set(attachmentPaths)) {
      const remaining = await prisma.attachment.count({ where: { storagePath } });
      if (remaining === 0) await deleteUpload(storagePath);
    }
    await refreshOrDeleteThread(message.threadId);
    return json({ ok: true, permanent: true });
  });
}
