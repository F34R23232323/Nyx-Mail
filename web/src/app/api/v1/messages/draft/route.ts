import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { deleteUpload } from "@nyxmail/shared/storage";
import { draftSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, parseBody, safe } from "@/lib/http";
import { getFolderByType } from "@/lib/folders";
import { messageToDTO } from "@/lib/serializers";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const include = { folder: true, labels: true, attachmentRows: true } as const;

async function refreshThread(threadId: string): Promise<void> {
  const count = await prisma.message.count({ where: { threadId } });
  if (count === 0) {
    await prisma.thread.deleteMany({ where: { id: threadId } });
    return;
  }
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

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`draft:${getClientIp(request)}:${auth.userId}`, 180, 5 * 60 * 1000);
    const body = await parseBody(request, draftSchema);

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        aliases: { where: { active: true } },
        gmailAccounts: { where: { enabled: true } },
      },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    const ownAddresses = [
      user.email,
      ...user.aliases.map((alias) => alias.address),
      ...user.gmailAccounts.map((account) => account.googleEmail),
    ].map(normalizeEmail);
    const fromAddress = normalizeEmail(body.fromAddress || user.email);
    if (!ownAddresses.includes(fromAddress)) {
      throw new ApiError(403, "You can only save drafts from a verified address", "invalid_sender");
    }
    const selfWrap =
      body.sealed.wraps[fromAddress] ||
      body.sealed.wraps[user.email] ||
      ownAddresses.map((address) => body.sealed.wraps[address]).find(Boolean);
    if (!selfWrap) throw new ApiError(400, "Missing encrypted key for this draft", "missing_wrap");

    const draft = body.id
      ? await prisma.message.findFirst({
          where: {
            id: body.id,
            userId: user.id,
            isDraft: true,
            folder: { type: "DRAFTS" },
          },
          include: { attachmentRows: true },
        })
      : null;
    if (body.id && !draft) throw new ApiError(404, "Draft not found", "not_found");

    const attachments = body.attachments ?? [];
    const blobIds = Array.from(new Set(attachments.map((attachment) => attachment.blobId)));
    const attachmentRows = blobIds.length
      ? await prisma.attachment.findMany({
          where: { userId: user.id, blobId: { in: blobIds } },
        })
      : [];
    if (attachmentRows.length !== blobIds.length) {
      throw new ApiError(400, "One or more attachments are missing", "attachment_missing");
    }
    for (const row of attachmentRows) {
      if (row.messageId && row.messageId !== draft?.id) {
        throw new ApiError(400, "Attachment is already linked to another message", "attachment_linked");
      }
    }
    const dropped = draft
      ? await prisma.attachment.findMany({
          where: {
            messageId: draft.id,
            blobId: { notIn: blobIds.length ? blobIds : ["__none__"] },
          },
          select: { id: true, sizeBytes: true, storagePath: true },
        })
      : [];

    const cipherSize =
      Buffer.byteLength(body.sealed.encryptedSubject) + Buffer.byteLength(body.sealed.encryptedBody);
    const oldCipherSize = draft
      ? Buffer.byteLength(draft.encryptedSubject) + Buffer.byteLength(draft.encryptedBody)
      : 0;
    const droppedBytes = dropped.reduce((sum, row) => sum + row.sizeBytes, 0);
    const storageDelta = cipherSize - oldCipherSize - droppedBytes;
    if (user.storageUsedBytes + storageDelta > user.storageLimitBytes) {
      throw new ApiError(507, "Your mailbox is full", "quota_exceeded");
    }

    const drafts = await getFolderByType(user.id, "DRAFTS");
    const now = new Date();
    let threadId = draft?.threadId;
    if (threadId && body.threadId && body.threadId !== threadId) {
      const owned = await prisma.thread.findFirst({
        where: { id: body.threadId, userId: user.id },
        select: { id: true },
      });
      if (owned) threadId = owned.id;
    }
    if (!threadId) {
      if (body.threadId) {
        const owned = await prisma.thread.findFirst({
          where: { id: body.threadId, userId: user.id },
          select: { id: true },
        });
        threadId = owned?.id;
      }
    }
    if (!threadId) {
      const thread = await prisma.thread.create({
        data: {
          userId: user.id,
          threadKey: `draft-${randomUUID()}`,
          subjectPreview: body.sealed.encryptedSubject,
          lastActivityAt: now,
          messageCount: 0,
        },
      });
      threadId = thread.id;
    }

    const attachmentJson = attachmentRows.map((row) => ({
      blobId: row.blobId,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      contentId: row.contentId,
      inline: row.inline,
    })) as Prisma.InputJsonValue;

    const saved = await prisma.$transaction(async (tx) => {
      let messageId: string;
      if (draft) {
        const updated = await tx.message.update({
          where: { id: draft.id },
          data: {
            threadId,
            fromAddress,
            toAddresses: (body.to ?? []) as unknown as Prisma.InputJsonValue,
            ccAddresses: (body.cc ?? []) as unknown as Prisma.InputJsonValue,
            bccAddresses: (body.bcc ?? []) as unknown as Prisma.InputJsonValue,
            encryptedSubject: body.sealed.encryptedSubject,
            encryptedBody: body.sealed.encryptedBody,
            wrappedKey: selfWrap,
            attachments: attachmentJson,
            inReplyTo: body.inReplyTo ?? null,
            references: (body.references || []) as Prisma.InputJsonValue,
            isDraft: true,
            sentAt: now,
            receivedAt: now,
            sizeBytes: cipherSize + attachmentRows.reduce((sum, row) => sum + row.sizeBytes, 0),
            snoozeUntil: null,
          },
        });
        messageId = updated.id;
      } else {
        const created = await tx.message.create({
          data: {
            userId: user.id,
            folderId: drafts.id,
            threadId,
            messageIdHeader: null,
            inReplyTo: body.inReplyTo ?? null,
            references: (body.references || []) as Prisma.InputJsonValue,
            fromAddress,
            fromName: user.displayName,
            toAddresses: (body.to ?? []) as unknown as Prisma.InputJsonValue,
            ccAddresses: (body.cc ?? []) as unknown as Prisma.InputJsonValue,
            bccAddresses: (body.bcc ?? []) as unknown as Prisma.InputJsonValue,
            encryptedSubject: body.sealed.encryptedSubject,
            encryptedBody: body.sealed.encryptedBody,
            wrappedKey: selfWrap,
            attachments: attachmentJson,
            isRead: true,
            isDraft: true,
            sentAt: now,
            receivedAt: now,
            sizeBytes: cipherSize + attachmentRows.reduce((sum, row) => sum + row.sizeBytes, 0),
          },
        });
        messageId = created.id;
      }
      await tx.attachment.updateMany({
        where: { userId: user.id, blobId: { in: blobIds } },
        data: { messageId },
      });
      if (dropped.length) {
        await tx.attachment.deleteMany({ where: { id: { in: dropped.map((row) => row.id) } } });
      }
      await tx.user.update({
        where: { id: user.id },
        data: { storageUsedBytes: { increment: storageDelta } },
      });
      return messageId;
    });

    if (draft && draft.threadId !== threadId) {
      await refreshThread(draft.threadId).catch(() => undefined);
    }
    await refreshThread(threadId);
    for (const row of dropped) await deleteUpload(row.storagePath);

    const message = await prisma.message.findUniqueOrThrow({ where: { id: saved }, include });
    return json(
      { message: messageToDTO(message), draftId: saved },
      { status: draft ? 200 : 201 },
    );
  });
}
