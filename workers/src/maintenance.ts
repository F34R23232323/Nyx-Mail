import { prisma } from "@nyxmail/db";
import { deleteUpload } from "@nyxmail/shared/storage";

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

export async function purgeExpiredTrash(): Promise<number> {
  const expired = await prisma.message.findMany({
    where: { purgeAt: { lte: new Date() } },
    take: 100,
    include: { attachmentRows: { select: { storagePath: true } } },
  });
  let purged = 0;
  for (const message of expired) {
    const paths = new Set(message.attachmentRows.map((attachment) => attachment.storagePath));
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: message.userId },
          select: { storageUsedBytes: true },
        });
        await tx.message.delete({ where: { id: message.id } });
        await tx.user.update({
          where: { id: message.userId },
          data: {
            storageUsedBytes: Math.max(0, (user?.storageUsedBytes ?? 0) - message.sizeBytes),
          },
        });
      });
      for (const path of paths) {
        const references = await prisma.attachment.count({ where: { storagePath: path } });
        if (references === 0) await deleteUpload(path);
      }
      await refreshThread(message.threadId);
      purged += 1;
    } catch (error) {
      console.error(`[nyxmail:worker] failed to purge ${message.id}`, error);
    }
  }
  return purged;
}

export async function wakeSnoozedMessages(): Promise<number> {
  const result = await prisma.message.updateMany({
    where: { snoozeUntil: { not: null, lte: new Date() } },
    data: { snoozeUntil: null },
  });
  return result.count;
}

export async function recoverStuckJobs(): Promise<void> {
  // NyxMail intentionally runs a single worker. Any RUNNING import at worker
  // startup belongs to a previous process and must be resumed immediately.
  await prisma.importJob.updateMany({
    where: { status: "RUNNING" },
    data: { status: "PENDING" },
  });
  const stale = new Date(Date.now() - 15 * 60 * 1000);
  await prisma.scheduledSend.updateMany({
    where: { status: "SENDING", updatedAt: { lt: stale } },
    data: {
      status: "FAILED",
      error: "Worker stopped while sending. Check your outbox before retrying.",
      relayPayload: "",
    },
  });
}

export async function cleanup(): Promise<void> {
  await Promise.allSettled([
    purgeExpiredTrash(),
    wakeSnoozedMessages(),
    prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          { revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
    }),
    prisma.transportLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.scheduledSend.deleteMany({
      where: {
        status: { in: ["SENT", "FAILED", "CANCELLED"] },
        updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
}
