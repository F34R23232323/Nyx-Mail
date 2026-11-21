import { randomUUID } from "node:crypto";
import { prisma } from "@nyxmail/db";
import { normalizeSubject } from "@nyxmail/shared";

export function uniqueReferences(...lists: Array<Array<string | null | undefined>>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const list of lists) {
    for (const ref of list) {
      if (!ref) continue;
      const trimmed = ref.trim();
      if (!trimmed.startsWith("<")) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      output.push(trimmed);
    }
  }
  return output;
}

export async function findThreadByReferences(
  userId: string,
  messageIds: string[],
): Promise<string | null> {
  const refs = messageIds.filter(Boolean);
  if (refs.length === 0) return null;
  const message = await prisma.message.findFirst({
    where: { userId, messageIdHeader: { in: refs } },
    orderBy: { sentAt: "desc" },
    select: { threadId: true },
  });
  return message?.threadId ?? null;
}

export async function resolveThreadForInbound(input: {
  userId: string;
  references: string[];
  inReplyTo?: string | null;
  messageId?: string | null;
  encryptedSubject: string;
  date: Date;
}): Promise<string> {
  const refs = uniqueReferences(input.references, input.inReplyTo ? [input.inReplyTo] : []);
  const existing = await findThreadByReferences(input.userId, refs);
  if (existing) {
    await prisma.thread.update({
      where: { id: existing },
      data: { lastActivityAt: input.date },
    });
    return existing;
  }

  const threadKey = input.messageId || randomUUID();
  const thread = await prisma.thread.upsert({
    where: {
      userId_threadKey: {
        userId: input.userId,
        threadKey,
      },
    },
    create: {
      userId: input.userId,
      threadKey,
      subjectPreview: input.encryptedSubject,
      lastActivityAt: input.date,
      messageCount: 0,
    },
    update: { lastActivityAt: input.date },
    select: { id: true },
  });
  return thread.id;
}

export async function resolveThreadForOutbound(input: {
  userId: string;
  threadId?: string | null;
  references?: string[];
  inReplyTo?: string | null;
  encryptedSubject: string;
  date: Date;
}): Promise<string> {
  if (input.threadId) {
    const owned = await prisma.thread.findFirst({
      where: { id: input.threadId, userId: input.userId },
      select: { id: true },
    });
    if (owned) {
      await prisma.thread.update({
        where: { id: owned.id },
        data: { lastActivityAt: input.date },
      });
      return owned.id;
    }
  }
  const existing = await findThreadByReferences(
    input.userId,
    uniqueReferences(input.references ?? [], input.inReplyTo ? [input.inReplyTo] : []),
  );
  if (existing) {
    await prisma.thread.update({
      where: { id: existing },
      data: { lastActivityAt: input.date },
    });
    return existing;
  }
  const thread = await prisma.thread.create({
    data: {
      userId: input.userId,
      threadKey: `out-${randomUUID()}`,
      subjectPreview: input.encryptedSubject,
      lastActivityAt: input.date,
      messageCount: 0,
    },
  });
  return thread.id;
}

export async function touchThread(threadId: string, date: Date): Promise<void> {
  await prisma.thread.update({
    where: { id: threadId },
    data: {
      lastActivityAt: date,
      messageCount: { increment: 1 },
    },
  });
}

export function canonicalThreadKey(subject: string): string {
  return normalizeSubject(subject).slice(0, 180);
}
