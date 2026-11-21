import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@nyxmail/db";
import { decryptAttachmentBytes } from "@nyxmail/crypto";
import {
  findLocalRecipient,
  findThreadByReferences,
  normalizeEmailContent,
  resolveThreadForOutbound,
  sendOutbound,
  uniqueReferences,
  type OutboundAttachment,
} from "@nyxmail/server";
import { GmailSendError, sendGmailMessage } from "./gmail";
import {
  dedupeAddresses,
  domainOf,
  normalizeEmail,
  type Address,
  type ClientAttachmentMeta,
  type SendMessageInput,
} from "@nyxmail/shared";
import { deleteUpload, readUpload } from "@nyxmail/shared/storage";
export class OutboundError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "send_error",
  ) {
    super(message);
  }
}

function mailDomain(): string {
  return (process.env.MAIL_DOMAIN || "localhost").trim().toLowerCase();
}

export function isLocalOnlySender(address: string): boolean {
  const domain = domainOf(address);
  return (
    !domain ||
    !domain.includes(".") ||
    domain === "localhost" ||
    domain.endsWith(".localhost") ||
    domain.endsWith(".local") ||
    domain.endsWith(".internal") ||
    domain.endsWith(".test") ||
    domain.endsWith(".invalid")
  );
}

async function getFolderByType(userId: string, type: "SENT" | "INBOX" | "ARCHIVE" | "TRASH" | "SPAM" | "DRAFTS") {
  const existing = await prisma.folder.findFirst({
    where: { userId, type },
    select: { id: true, name: true, type: true },
  });
  if (existing) return existing;
  const name = type.charAt(0) + type.slice(1).toLowerCase();
  return prisma.folder.create({
    data: { userId, name, type, order: 0 },
    select: { id: true, name: true, type: true },
  });
}

export interface PerformSendInput extends Omit<SendMessageInput, "scheduledFor"> {
  userId: string;
}

export interface SendOutcome {
  sentMessageId: string;
  threadId: string;
  deliveredInternally: number;
  externalRecipients: number;
  warnings: string[];
}

interface AttachmentRow {
  id: string;
  blobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  contentId: string | null;
  inline: boolean;
  messageId: string | null;
}

function attachmentMetadata(row: AttachmentRow) {
  return {
    blobId: row.blobId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    contentId: row.contentId,
    inline: row.inline,
  };
}

async function loadAttachmentRows(
  userId: string,
  attachments: PerformSendInput["attachments"],
  draftId?: string | null,
): Promise<AttachmentRow[]> {
  const blobIds = Array.from(new Set(attachments.map((attachment) => attachment.blobId)));
  if (blobIds.length === 0) return [];
  const rows = await prisma.attachment.findMany({
    where: { userId, blobId: { in: blobIds } },
  });
  if (rows.length !== blobIds.length) {
    throw new OutboundError(400, "One or more attachments are missing", "attachment_missing");
  }
  for (const row of rows) {
    if (row.messageId && row.messageId !== draftId) {
      throw new OutboundError(400, "Attachment is already linked to another message", "attachment_linked");
    }
  }
  return rows;
}

async function recordContact(userId: string, email: string, name?: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  try {
    const existing = await prisma.contact.findFirst({
      where: { userId, dedupeKey: normalized },
      select: { id: true, name: true },
    });
    if (existing) {
      if (!existing.name && name) {
        await prisma.contact.update({ where: { id: existing.id }, data: { name: name.slice(0, 160) } });
      }
      return;
    }
    await prisma.contact.create({
      data: {
        userId,
        email: normalized,
        dedupeKey: normalized,
        name: (name || normalized.split("@")[0]).slice(0, 160),
      },
    });
  } catch {
    // Contact collection is best-effort and must never fail a send.
  }
}

async function refreshThread(threadId: string, fallbackDate: Date): Promise<void> {
  const [count, latest] = await Promise.all([
    prisma.message.count({ where: { threadId } }),
    prisma.message.findFirst({
      where: { threadId },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);
  if (count === 0) {
    await prisma.thread.deleteMany({ where: { id: threadId } });
    return;
  }
  await prisma.thread.update({
    where: { id: threadId },
    data: { messageCount: count, lastActivityAt: latest?.sentAt ?? fallbackDate },
  });
}

async function resolveRecipientThread(input: {
  recipientUserId: string;
  senderThreadId: string;
  references: string[];
  inReplyTo?: string | null;
  encryptedSubject: string;
  date: Date;
}): Promise<string> {
  if (input.recipientUserId) {
    // Recipients that already have one of the referenced messages share that
    // conversation. This is what makes replies thread correctly for internal
    // mail without the server ever parsing subjects.
    const refs = uniqueReferences(input.references ?? [], input.inReplyTo ? [input.inReplyTo] : []);
    const existing = await findThreadByReferences(input.recipientUserId, refs);
    if (existing) {
      await prisma.thread.update({ where: { id: existing }, data: { lastActivityAt: input.date } });
      return existing;
    }
  }
  const thread = await prisma.thread.create({
    data: {
      userId: input.recipientUserId,
      threadKey: `delivery-${randomUUID()}`,
      subjectPreview: input.encryptedSubject,
      lastActivityAt: input.date,
      messageCount: 0,
    },
  });
  return thread.id;
}

async function buildRelayAttachments(
  rows: AttachmentRow[],
  keys: Record<string, string> | undefined,
): Promise<OutboundAttachment[]> {
  const result: OutboundAttachment[] = [];
  for (const row of rows) {
    const key = keys?.[row.blobId];
    if (!key) {
      throw new OutboundError(400, `Missing relay key for attachment ${row.filename}`, "attachment_key_missing");
    }
    let ciphertext: Buffer;
    try {
      ciphertext = await readUpload(row.storagePath);
    } catch {
      throw new OutboundError(500, `Attachment ${row.filename} is unavailable`, "attachment_storage");
    }
    let plain: Uint8Array;
    try {
      plain = await decryptAttachmentBytes(ciphertext, key);
    } catch {
      throw new OutboundError(400, `Attachment ${row.filename} could not be decrypted`, "attachment_decrypt");
    }
    result.push({
      filename: row.filename,
      mimeType: row.mimeType,
      content: Buffer.from(plain),
      cid: row.contentId,
    });
  }
  return result;
}

function normalizeAddresses(input: Address[]): Address[] {
  return dedupeAddresses(
    input
      .filter((address) => address && typeof address.email === "string")
      .map((address) => ({
        email: normalizeEmail(address.email),
        name: address.name?.trim().slice(0, 160) || undefined,
      })),
  );
}

export async function performImmediateSend(input: PerformSendInput): Promise<SendOutcome> {
  const warnings: string[] = [];
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: {
      aliases: { where: { active: true } },
      gmailAccounts: { where: { enabled: true } },
    },
  });
  if (!user) throw new OutboundError(404, "Account not found", "not_found");

  const fromAddress = normalizeEmail(input.fromAddress);
  const gmailAccount =
    (input.gmailAccountId
      ? user.gmailAccounts.find((account) => account.id === input.gmailAccountId)
      : undefined) ??
    user.gmailAccounts.find((account) => normalizeEmail(account.googleEmail) === fromAddress);
  if (input.gmailAccountId && !gmailAccount) {
    throw new OutboundError(403, "That Gmail account is not connected", "gmail_not_connected");
  }
  if (gmailAccount && normalizeEmail(gmailAccount.googleEmail) !== fromAddress) {
    throw new OutboundError(
      403,
      "The selected Gmail account does not match the From address",
      "gmail_sender_mismatch",
    );
  }
  const ownAddresses = [
    user.email,
    ...user.aliases.map((alias) => alias.address),
    ...user.gmailAccounts.map((account) => account.googleEmail),
  ].map(normalizeEmail);
  if (!ownAddresses.includes(fromAddress)) {
    throw new OutboundError(403, "You can only send from your verified addresses", "invalid_sender");
  }

  const to = normalizeAddresses(input.to);
  const cc = normalizeAddresses(input.cc).filter(
    (address) => !to.some((item) => item.email === address.email),
  );
  const bcc = normalizeAddresses(input.bcc).filter(
    (address) => !to.some((item) => item.email === address.email) && !cc.some((item) => item.email === address.email),
  );
  if (to.length === 0) throw new OutboundError(400, "At least one recipient is required", "invalid_recipients");

  const allRecipients = [...to, ...cc, ...bcc];
  const localByAddress = new Map<string, Awaited<ReturnType<typeof findLocalRecipient>>>();
  const recipientMap = new Map<
    string,
    { userId: string; addresses: string[]; publicKey: string }
  >();
  const external: Address[] = [];

  for (const address of allRecipients) {
    const recipient = await findLocalRecipient(address.email);
    localByAddress.set(address.email, recipient);
    if (!recipient) {
      external.push(address);
      continue;
    }
    const existing = recipientMap.get(recipient.userId);
    if (existing) {
      existing.addresses.push(address.email);
    } else {
      recipientMap.set(recipient.userId, {
        userId: recipient.userId,
        addresses: [address.email],
        publicKey: recipient.publicKey,
      });
    }
  }

  // Every locally delivered copy must have a sealed message key wrapped for
  // that recipient, and the sender's Sent copy must be decryptable by them.
  for (const [userId, recipient] of recipientMap) {
    const hasWrap = recipient.addresses.some((address) => Boolean(input.sealed.wraps[address]));
    if (!hasWrap) {
      throw new OutboundError(400, "Missing encrypted key for a local recipient", "missing_wrap");
    }
    if (userId === user.id) {
      // The wrap above also unlocks the Sent copy.
    }
  }
  const selfWrap =
    input.sealed.wraps[fromAddress] ||
    input.sealed.wraps[user.email] ||
    ownAddresses.map((address) => input.sealed.wraps[address]).find(Boolean);
  if (!selfWrap) {
    throw new OutboundError(400, "Missing encrypted key for your Sent copy", "missing_self_wrap");
  }

  const draft = input.draftId
    ? await prisma.message.findFirst({
        where: {
          id: input.draftId,
          userId: user.id,
          isDraft: true,
          folder: { type: "DRAFTS" },
        },
        include: { attachmentRows: true },
      })
    : null;
  if (input.draftId && !draft) throw new OutboundError(404, "Draft not found", "draft_not_found");

  const attachmentRows = await loadAttachmentRows(
    user.id,
    input.attachments,
    draft?.id ?? null,
  );
  const droppedStoragePaths: string[] = [];
  const attachmentBytes = attachmentRows.reduce((sum, row) => sum + row.sizeBytes, 0);
  const cipherSize =
    Buffer.byteLength(input.sealed.encryptedSubject) + Buffer.byteLength(input.sealed.encryptedBody);
  const draftCipherSize = draft
    ? Buffer.byteLength(draft.encryptedSubject) + Buffer.byteLength(draft.encryptedBody)
    : 0;
  const senderDelta = cipherSize - draftCipherSize;
  if (user.storageUsedBytes + senderDelta > user.storageLimitBytes) {
    throw new OutboundError(507, "Your mailbox is full", "quota_exceeded");
  }

  const externalTo = to.filter((address) => !localByAddress.get(address.email));
  const externalCc = cc.filter((address) => !localByAddress.get(address.email));
  const externalBcc = bcc.filter((address) => !localByAddress.get(address.email));
  const externalRecipients = [...externalTo, ...externalCc, ...externalBcc];

  const now = new Date();
  const messageIdHeader = `<${randomUUID()}@${mailDomain()}>`;
  const references = uniqueReferences(input.references ?? [], input.inReplyTo ? [input.inReplyTo] : []);

  if (externalRecipients.length > 0) {
    if (!input.relay) {
      throw new OutboundError(
        400,
        "External recipients require the relay payload. Internal-only mail never leaves ciphertext.",
        "relay_required",
      );
    }
    const sanitized = normalizeEmailContent(input.relay.html, input.relay.text);
    const relayAttachments = await buildRelayAttachments(attachmentRows, input.relay.attachmentKeys);
    const subject = input.relay.subject.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 998);
    const outbound = {
      from: { name: user.displayName, email: fromAddress },
      subject,
      html: sanitized.html,
      text: sanitized.text,
      attachments: relayAttachments,
      inReplyTo: input.inReplyTo ?? undefined,
      references,
      headers: {
        "Message-ID": messageIdHeader,
        "X-NyxMail-Transport": gmailAccount ? "gmail" : "external",
      },
    } as const;

    if (gmailAccount) {
      try {
        await sendGmailMessage(user.id, gmailAccount, {
          ...outbound,
          // Only external recipients are handed to Google. Internal recipients
          // are delivered by the encrypted NyxMail pipeline below.
          to: externalTo,
          cc: externalCc,
          bcc: externalBcc,
        });
      } catch (error) {
        if (error instanceof GmailSendError) {
          throw new OutboundError(error.status, error.message, error.code);
        }
        throw error;
      }
    } else {
      if (isLocalOnlySender(fromAddress)) {
        throw new OutboundError(
          400,
          `External mail cannot be sent from ${fromAddress}. Choose one of your public addresses in the From menu.`,
          "invalid_external_sender",
        );
      }
      await sendOutbound(user.id, {
        ...outbound,
        to,
        cc: cc.length > 0 ? cc : [],
        bcc: [],
        envelope: {
          from: fromAddress,
          to: externalRecipients.map((address) => address.email),
        },
      });
    }
  }

  const sentFolder = await getFolderByType(user.id, "SENT");
  let sentThreadId: string;
  if (draft) {
    sentThreadId = input.threadId
      ? (
          await prisma.thread.findFirst({
            where: { id: input.threadId, userId: user.id },
            select: { id: true },
          })
        )?.id ?? draft.threadId
      : draft.threadId;
  } else {
    sentThreadId = await resolveThreadForOutbound({
      userId: user.id,
      threadId: input.threadId,
      references,
      inReplyTo: input.inReplyTo,
      encryptedSubject: input.sealed.encryptedSubject,
      date: now,
    });
  }

  const metadata = attachmentRows.map(attachmentMetadata);
  const attachmentJson = metadata as Prisma.InputJsonValue;
  const fromName = user.displayName.slice(0, 160);

  const touchedThreads = new Set<string>([sentThreadId]);
  const transactionResult = await prisma.$transaction(async (tx) => {
    let sentMessageId: string;
    if (draft) {
      const movedAttachments = await tx.attachment.findMany({
        where: { messageId: draft.id },
        select: { blobId: true },
      });
      const selectedBlobIds = new Set(attachmentRows.map((row) => row.blobId));
      const dropped = movedAttachments.filter((row) => !selectedBlobIds.has(row.blobId));
      const droppedRows = dropped.length
        ? await tx.attachment.findMany({
            where: { messageId: draft.id, blobId: { in: dropped.map((row) => row.blobId) } },
            select: { sizeBytes: true, storagePath: true },
          })
        : [];
      droppedStoragePaths.push(...droppedRows.map((row) => row.storagePath));

      const updated = await tx.message.update({
        where: { id: draft.id },
        data: {
          folderId: sentFolder.id,
          threadId: sentThreadId,
          messageIdHeader,
          inReplyTo: input.inReplyTo ?? null,
          references: references as Prisma.InputJsonValue,
          fromAddress,
          fromName,
          toAddresses: to as unknown as Prisma.InputJsonValue,
          ccAddresses: cc as unknown as Prisma.InputJsonValue,
          bccAddresses: bcc as unknown as Prisma.InputJsonValue,
          encryptedSubject: input.sealed.encryptedSubject,
          encryptedBody: input.sealed.encryptedBody,
          wrappedKey: selfWrap,
          attachments: attachmentJson,
          isRead: true,
          isDraft: false,
          sentAt: now,
          receivedAt: now,
          sizeBytes: cipherSize + attachmentBytes,
          snoozeUntil: null,
        },
      });
      sentMessageId = updated.id;
      await tx.attachment.updateMany({
        where: { userId: user.id, blobId: { in: attachmentRows.map((row) => row.blobId) } },
        data: { messageId: sentMessageId },
      });
      // Unselected draft attachments are deleted with the draft; detach them
      // first so the cascade only removes the rows we intend to drop.
      if (dropped.length > 0) {
        await tx.attachment.deleteMany({
          where: { messageId: draft.id, blobId: { in: dropped.map((row) => row.blobId) } },
        });
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          storageUsedBytes: {
            increment:
              senderDelta -
              droppedRows.reduce((sum, row) => sum + row.sizeBytes, 0),
          },
        },
      });
      // A draft's thread may become empty if a different thread was chosen.
      if (draft.threadId !== sentThreadId) {
        await tx.thread.updateMany({
          where: { id: draft.threadId },
          data: { messageCount: { decrement: 1 } },
        });
      }
    } else {
      const created = await tx.message.create({
        data: {
          userId: user.id,
          folderId: sentFolder.id,
          threadId: sentThreadId,
          messageIdHeader,
          inReplyTo: input.inReplyTo ?? null,
          references: references as Prisma.InputJsonValue,
          fromAddress,
          fromName,
          toAddresses: to as unknown as Prisma.InputJsonValue,
          ccAddresses: cc as unknown as Prisma.InputJsonValue,
          bccAddresses: bcc as unknown as Prisma.InputJsonValue,
          encryptedSubject: input.sealed.encryptedSubject,
          encryptedBody: input.sealed.encryptedBody,
          wrappedKey: selfWrap,
          attachments: attachmentJson,
          isRead: true,
          isDraft: false,
          sentAt: now,
          receivedAt: now,
          sizeBytes: cipherSize + attachmentBytes,
        },
      });
      sentMessageId = created.id;
      await tx.attachment.updateMany({
        where: { userId: user.id, blobId: { in: attachmentRows.map((row) => row.blobId) } },
        data: { messageId: sentMessageId },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { storageUsedBytes: { increment: senderDelta } },
      });
    }

    const inboxFolder = await tx.folder.findFirst({
      where: { userId: user.id, type: "INBOX" },
      select: { id: true },
    });

    for (const recipient of recipientMap.values()) {
      const wrapAddress = recipient.addresses.find((address) => Boolean(input.sealed.wraps[address]))!;
      const wrap = input.sealed.wraps[wrapAddress];
      const isSelf = recipient.userId === user.id;
      const recipientUser = await tx.user.findUnique({
        where: { id: recipient.userId },
        select: { storageUsedBytes: true, storageLimitBytes: true },
      });
      if (!recipientUser) continue;
      const deliverySize = cipherSize + (isSelf ? 0 : attachmentBytes);
      if (recipientUser.storageUsedBytes + deliverySize > recipientUser.storageLimitBytes) {
        warnings.push(`Skipped delivery to ${wrapAddress}: mailbox is full`);
        continue;
      }
      const folder =
        isSelf && inboxFolder
          ? inboxFolder
          : await (async () => {
              const existing = await tx.folder.findFirst({
                where: { userId: recipient.userId, type: "INBOX" },
                select: { id: true },
              });
              if (existing) return existing;
              return tx.folder.create({
                data: { userId: recipient.userId, name: "Inbox", type: "INBOX", order: 0 },
                select: { id: true },
              });
            })();

      const threadId = isSelf
        ? sentThreadId
        : await resolveRecipientThread({
            recipientUserId: recipient.userId,
            senderThreadId: sentThreadId,
            references,
            inReplyTo: input.inReplyTo,
            encryptedSubject: input.sealed.encryptedSubject,
            date: now,
          });
      touchedThreads.add(threadId);

      const deliveredMessage = await tx.message.create({
        data: {
          userId: recipient.userId,
          folderId: folder.id,
          threadId,
          messageIdHeader: isSelf ? null : messageIdHeader,
          inReplyTo: input.inReplyTo ?? null,
          references: references as Prisma.InputJsonValue,
          fromAddress,
          fromName,
          toAddresses: to as unknown as Prisma.InputJsonValue,
          ccAddresses: cc as unknown as Prisma.InputJsonValue,
          bccAddresses: [],
          encryptedSubject: input.sealed.encryptedSubject,
          encryptedBody: input.sealed.encryptedBody,
          wrappedKey: wrap,
          attachments: attachmentJson,
          isRead: false,
          isDraft: false,
          sentAt: now,
          receivedAt: now,
          sizeBytes: isSelf ? cipherSize : cipherSize + attachmentBytes,
        },
      });

      if (!isSelf && attachmentRows.length > 0) {
        await tx.attachment.createMany({
          data: attachmentRows.map((row) => ({
            userId: recipient.userId,
            messageId: deliveredMessage.id,
            blobId: row.blobId,
            filename: row.filename,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            encryptedKey: "",
            storagePath: row.storagePath,
            contentId: row.contentId,
            inline: row.inline,
          })),
          skipDuplicates: true,
        });
      }

      await tx.user.update({
        where: { id: recipient.userId },
        data: { storageUsedBytes: { increment: deliverySize } },
      });
      await tx.thread.update({
        where: { id: threadId },
        data: { lastActivityAt: now },
      });
    }

    return sentMessageId;
  });

  for (const threadId of touchedThreads) {
    await refreshThread(threadId, now).catch(() => undefined);
  }
  if (draft && draft.threadId !== sentThreadId) {
    await refreshThread(draft.threadId, now).catch(() => undefined);
  }
  for (const storagePath of droppedStoragePaths) {
    await deleteUpload(storagePath);
  }
  for (const recipient of recipientMap.values()) {
    if (recipient.userId === user.id) continue;
    await recordContact(recipient.userId, fromAddress, user.displayName);
    for (const address of recipient.addresses) {
      await recordContact(user.id, address);
    }
  }
  for (const address of allRecipients) {
    if (!ownAddresses.includes(address.email)) {
      await recordContact(user.id, address.email, address.name);
    }
  }
  if (externalRecipients.length > 0) {
    for (const address of externalRecipients) {
      await recordContact(user.id, address.email, address.name);
    }
  }

  return {
    sentMessageId: transactionResult,
    threadId: sentThreadId,
    deliveredInternally: recipientMap.size,
    externalRecipients: externalRecipients.length,
    warnings,
  };
}

export { attachmentMetadata };
export type { AttachmentRow };
