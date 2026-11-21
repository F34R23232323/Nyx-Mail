import { randomUUID } from "node:crypto";
import { prisma, type FolderType, type Prisma } from "@nyxmail/db";
import { encryptInboundAttachment, sealInboundMessage } from "@nyxmail/crypto/server";
import {
  classifyMessage,
  isEmail,
  normalizeEmail,
  stripHtml,
  type FilterKind,
  type RuleAction,
  type RuleCondition,
  type RuleMatchType,
  type SpamCheckResult,
} from "@nyxmail/shared";
import { deleteUpload, writeUpload } from "@nyxmail/shared/storage";
import { extractSenderIp, parseEml, type AuthResultValues, type ParsedMessage } from "./parsers";
import { normalizeEmailContent } from "./sanitize";
import { evaluateSpam } from "./spam";
import { resolveThreadForInbound, touchThread } from "./threads";
import { findLocalRecipient } from "./recipients";
import { evaluateRules } from "./rules";

export interface IngestOptions {
  envelopeFrom?: string;
  envelopeTo: string[];
  raw: Buffer;
  authResults?: AuthResultValues;
  /** Importers deliver historical mail into an explicit folder and bypass
   * spam routing while still recording the authentication results. */
  targetFolderId?: string;
  /** Preserve the source read flag when the importer knows it. */
  markRead?: boolean;
  /** Preserve a star/flag from the source mailbox. */
  markStarred?: boolean;
  /** Labels to attach. Existing Message-ID matches are merged instead of duplicated. */
  addLabelIds?: string[];
  /** Mark imported messages in Drafts as editable drafts. */
  isDraft?: boolean;
}

export interface IngestDelivery {
  userId: string;
  messageId: string;
  threadId: string;
  spam: SpamCheckResult;
}

export interface IngestResult {
  delivered: IngestDelivery[];
  /** Recipients whose message was already stored in the target folder. */
  duplicates: number;
  skipped: Array<{ address: string; reason: string }>;
  errors: string[];
}

interface PreparedAttachment {
  blobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  key: string;
  sealedKey: string;
  storagePath: string;
  contentId: string | null;
  inline: boolean;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function cleanSubject(subject: string): string {
  return subject.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 998) || "(no subject)";
}

function cleanFilename(value: string): string {
  const name = value.replace(/[\\/\r\n\u0000]/g, "_").trim().slice(0, 200);
  return name || "attachment";
}

function authValue(value: string | undefined | null): string {
  if (!value) return "none";
  return ["pass", "fail", "softfail", "neutral", "none", "error"].includes(value)
    ? value
    : "none";
}

async function collectContact(
  userId: string,
  fromAddress: string,
  name: string | undefined,
  ownAddresses: Set<string>,
): Promise<void> {
  if (!isEmail(fromAddress)) return;
  const email = normalizeEmail(fromAddress);
  if (ownAddresses.has(email)) return;
  const existing = await prisma.contact.findFirst({
    where: { userId, dedupeKey: email },
    select: { id: true, name: true },
  });
  if (existing) {
    if (!existing.name && name) {
      await prisma.contact.update({ where: { id: existing.id }, data: { name } });
    }
    return;
  }
  await prisma.contact.create({
    data: {
      userId,
      name: name?.slice(0, 160) || email.split("@")[0],
      email,
      dedupeKey: email,
    },
  });
}

async function prepareAttachments(
  userId: string,
  parsedAttachments: ParsedMessage["attachments"],
  publicKey: string,
): Promise<{ prepared: PreparedAttachment[]; payload: Array<Record<string, unknown>>; errors: string[] }> {
  const prepared: PreparedAttachment[] = [];
  const payload: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let total = 0;
  for (const attachment of parsedAttachments) {
    if (attachment.content.length > MAX_ATTACHMENT_BYTES) {
      errors.push(`${attachment.filename}: exceeds the 25MB per-file limit`);
      continue;
    }
    total += attachment.content.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      errors.push(`${attachment.filename}: message attachment total exceeds 50MB`);
      break;
    }
    const encrypted = await encryptInboundAttachment(attachment.content, publicKey);
    const blobId = randomUUID();
    const storagePath = `${userId}/${blobId}.bin`;
    await writeUpload(storagePath, encrypted.ciphertext);
    const filename = cleanFilename(attachment.filename);
    const item: PreparedAttachment = {
      blobId,
      filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.content.length,
      key: encrypted.key,
      sealedKey: encrypted.sealedKey,
      storagePath,
      contentId: attachment.contentId,
      inline: attachment.inline,
    };
    prepared.push(item);
    payload.push({
      blobId,
      filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.content.length,
      contentId: attachment.contentId,
      inline: attachment.inline,
      key: encrypted.key,
    });
  }
  return { prepared, payload, errors };
}

const SYSTEM_FOLDER_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFTS: "Drafts",
  ARCHIVE: "Archive",
  SPAM: "Spam",
  TRASH: "Trash",
};

async function getOrCreateSystemFolder(
  userId: string,
  folders: Array<{ id: string; type: FolderType }>,
  type: "INBOX" | "ARCHIVE" | "SPAM" | "TRASH",
): Promise<{ id: string; type: FolderType }> {
  const existing = folders.find((folder) => folder.type === type);
  if (existing) return existing;
  const created = await prisma.folder.create({
    data: {
      userId,
      name: SYSTEM_FOLDER_NAMES[type] ?? type,
      type,
      order: { INBOX: 0, ARCHIVE: 3, SPAM: 4, TRASH: 5 }[type],
    },
    select: { id: true, type: true },
  });
  folders.push(created);
  return created;
}

export async function ingestRawMessage(options: IngestOptions): Promise<IngestResult> {
  const parsed = await parseEml(options.raw);
  const result: IngestResult = { delivered: [], duplicates: 0, skipped: [], errors: [] };

  const envelopeTo = options.envelopeTo?.length
    ? options.envelopeTo
    : [...parsed.to, ...parsed.cc, ...parsed.bcc].map((a) => a.email);
  const uniqueRecipients = Array.from(new Set(envelopeTo.map(normalizeEmail).filter(Boolean)));

  if (uniqueRecipients.length === 0) {
    result.skipped.push({ address: "", reason: "no envelope recipients" });
    return result;
  }

  const recipients = new Map<
    string,
    {
      address: string;
      publicKey: string;
      displayName: string;
      deliveredToAddresses: string[];
    }
  >();
  for (const address of uniqueRecipients) {
    const recipient = await findLocalRecipient(address);
    if (!recipient) {
      result.skipped.push({ address, reason: "recipient is not hosted here" });
      continue;
    }
    const deliveredToAddresses = Array.from(
      new Set(
        [normalizeEmail(address), normalizeEmail(recipient.catchAllTarget ?? "")]
          .filter(Boolean),
      ),
    );
    const existing = recipients.get(recipient.userId);
    if (existing) {
      existing.deliveredToAddresses = Array.from(
        new Set([...existing.deliveredToAddresses, ...deliveredToAddresses]),
      );
      continue;
    }
    recipients.set(recipient.userId, {
      address,
      publicKey: recipient.publicKey,
      displayName: recipient.displayName,
      deliveredToAddresses,
    });
  }

  if (recipients.size === 0) return result;

  const fromEmail = isEmail(parsed.from.email)
    ? normalizeEmail(parsed.from.email)
    : isEmail(options.envelopeFrom ?? "")
      ? normalizeEmail(options.envelopeFrom!)
      : "unknown@invalid.local";
  const subject = cleanSubject(parsed.subject);
  const content = normalizeEmailContent(parsed.html, parsed.text);
  const senderIp = extractSenderIp(parsed.received);
  const replyTo = parsed.headers["reply-to"] || null;
  const spf = authValue(options.authResults?.spf ?? parsed.spf);
  const dkim = authValue(options.authResults?.dkim ?? parsed.dkim);
  const dmarc = authValue(options.authResults?.dmarc ?? parsed.dmarc);
  const classification = classifyMessage({
    fromAddress: fromEmail,
    fromName: parsed.from.name || null,
    subject,
    text: content.text,
    html: content.html,
    attachmentNames: parsed.attachments.map((attachment) => attachment.filename),
  });
  const receivedAt = new Date();
  const sentAt = parsed.date.getTime() > receivedAt.getTime() + 5 * 60_000 ? receivedAt : parsed.date;

  for (const [userId, recipient] of recipients) {
    const writtenPaths: string[] = [];
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          storageUsedBytes: true,
          storageLimitBytes: true,
          filters: { select: { kind: true, pattern: true } },
          aliases: { where: { active: true }, select: { address: true } },
          folders: { select: { id: true, type: true } },
          labels: { select: { id: true } },
          contacts: {
            where: { dedupeKey: fromEmail },
            select: { id: true },
            take: 1,
          },
          mailRules: {
            where: { enabled: true },
            orderBy: { priority: "asc" },
            select: {
              id: true,
              name: true,
              enabled: true,
              priority: true,
              matchType: true,
              conditions: true,
              expression: true,
              actions: true,
              stopProcessing: true,
            },
          },
        },
      });
      if (!user) {
        result.skipped.push({ address: recipient.address, reason: "user disappeared" });
        continue;
      }

      const ownAddresses = new Set(
        [user.email, ...user.aliases.map((alias) => alias.address)].map(normalizeEmail),
      );

      let spam: SpamCheckResult = { spam: false, score: 0, reasons: ["imported mail"] };
      let targetFolder: { id: string; type: FolderType } | null = null;
      let ruleResult: ReturnType<typeof evaluateRules> | null = null;
      const folderList = user.folders.map((folder) => ({ ...folder }));

      if (options.targetFolderId) {
        const target = folderList.find((folder) => folder.id === options.targetFolderId);
        if (!target) {
          result.skipped.push({ address: recipient.address, reason: "import folder missing" });
          continue;
        }
        targetFolder = target;
      } else {
        const senderStat = await prisma.senderStat.findUnique({
          where: { userId_address: { userId, address: fromEmail } },
          select: { spamReports: true, hamReports: true },
        });
        spam = await evaluateSpam({
          fromAddress: fromEmail,
          fromName: parsed.from.name || null,
          subject,
          text: content.text,
          html: content.html,
          raw: options.raw,
          toAddresses: parsed.to.map((item) => item.email),
          recipient: recipient.address,
          replyTo,
          spf,
          dkim,
          dmarc,
          senderIp,
          userId,
          filters: user.filters.map((f) => ({ kind: f.kind as FilterKind, pattern: f.pattern })),
          senderSpamReports: senderStat?.spamReports ?? 0,
          senderHamReports: senderStat?.hamReports ?? 0,
          knownSender: user.contacts.length > 0,
          rblZone: process.env.RBL_ZONE || null,
        });

        ruleResult = evaluateRules(
          user.mailRules.map((rule) => ({
            ...rule,
            matchType: rule.matchType as RuleMatchType,
            conditions: rule.conditions as unknown as RuleCondition[],
            actions: rule.actions as unknown as RuleAction[],
          })),
          {
            fromAddress: fromEmail,
            fromName: parsed.from.name || null,
            toAddresses: parsed.to.map((item) => item.email),
            ccAddresses: parsed.cc.map((item) => item.email),
            bccAddresses: parsed.bcc.map((item) => item.email),
            deliveredTo: recipient.address,
            deliveredToAddresses: recipient.deliveredToAddresses,
            subject,
            text: content.text,
            html: content.html,
            attachmentNames: parsed.attachments.map((attachment) => attachment.filename),
            sizeBytes:
              Buffer.byteLength(content.html) +
              Buffer.byteLength(content.text) +
              parsed.attachments.reduce((sum, attachment) => sum + attachment.content.length, 0),
            spamScore: spam.score,
            spf,
            dkim,
            dmarc,
          },
        );

        targetFolder = await getOrCreateSystemFolder(
          userId,
          folderList,
          spam.spam ? "SPAM" : "INBOX",
        );

        if (ruleResult.folderTarget) {
          const target = ruleResult.folderTarget;
          if (target.kind === "move" && target.folderId) {
            const custom = folderList.find(
              (folder) => folder.id === target.folderId && !["SENT", "DRAFTS"].includes(folder.type),
            );
            if (custom) targetFolder = custom;
          } else if (target.kind === "archive") {
            targetFolder = await getOrCreateSystemFolder(userId, folderList, "ARCHIVE");
          } else if (target.kind === "spam") {
            targetFolder = await getOrCreateSystemFolder(userId, folderList, "SPAM");
          } else if (target.kind === "trash") {
            targetFolder = await getOrCreateSystemFolder(userId, folderList, "TRASH");
          }
        }
      }

      const folder = targetFolder ?? (await getOrCreateSystemFolder(userId, folderList, "INBOX"));
      const trashed = folder.type === "TRASH";
      const ruleLabelIds = new Set(
        [
          ...(ruleResult?.labelIds ?? []),
          ...(options.addLabelIds ?? []),
        ].filter((id) => user.labels.some((label) => label.id === id)),
      );

      if (parsed.messageId) {
        // Message-IDs are global per mailbox. Imports into different folders
        // (for example Gmail re-importing a message already filed under a label)
        // must merge into the existing copy instead of creating a duplicate.
        const duplicate = await prisma.message.findFirst({
          where: { userId, messageIdHeader: parsed.messageId },
          select: { id: true },
        });
        if (duplicate) {
          const labelIds = Array.from(ruleLabelIds);
          const markRead = ruleResult?.markRead === true || options.markRead === true;
          const markStarred = ruleResult?.star === true || options.markStarred === true;
          if (labelIds.length > 0 || markRead || markStarred) {
            await prisma.message.update({
              where: { id: duplicate.id },
              data: {
                ...(labelIds.length
                  ? { labels: { connect: labelIds.map((id) => ({ id })) } }
                  : {}),
                ...(markRead ? { isRead: true } : {}),
                ...(markStarred ? { isStarred: true } : {}),
              },
            });
          }
          result.duplicates += 1;
          result.skipped.push({
            address: recipient.address,
            reason: labelIds.length ? "duplicate message id; labels merged" : "duplicate message id",
          });
          continue;
        }
      }

      const { prepared, payload, errors } = await prepareAttachments(
        userId,
        parsed.attachments,
        recipient.publicKey,
      );
      writtenPaths.push(...prepared.map((a) => a.storagePath));
      result.errors.push(...errors.map((error) => `${recipient.address}: ${error}`));

      const attachmentBytes = prepared.reduce((sum, item) => sum + item.sizeBytes, 0);
      const preliminarySize = Buffer.byteLength(content.html) + Buffer.byteLength(content.text) + attachmentBytes;
      if (user.storageUsedBytes + preliminarySize > user.storageLimitBytes) {
        for (const storagePath of writtenPaths) await deleteUpload(storagePath);
        result.skipped.push({ address: recipient.address, reason: "storage quota exceeded" });
        continue;
      }

      const sealed = await sealInboundMessage(
        subject,
        { html: content.html, text: content.text, attachments: payload },
        recipient.publicKey,
      );

      const threadId = await resolveThreadForInbound({
        userId,
        references: parsed.references,
        inReplyTo: parsed.inReplyTo,
        messageId: parsed.messageId,
        encryptedSubject: sealed.encryptedSubject,
        date: sentAt,
      });

      const messageSize = sealed.sizeBytes + attachmentBytes;
      const metadata = prepared.map((attachment) => ({
        blobId: attachment.blobId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        contentId: attachment.contentId,
        inline: attachment.inline,
      }));

      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            userId,
            folderId: folder.id,
            threadId,
            messageIdHeader: parsed.messageId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references as Prisma.InputJsonValue,
            fromAddress: fromEmail,
            fromName: parsed.from.name?.slice(0, 160) || null,
            toAddresses: (parsed.to.length ? parsed.to : [{ email: recipient.address }]) as unknown as Prisma.InputJsonValue,
            ccAddresses: parsed.cc as unknown as Prisma.InputJsonValue,
            bccAddresses: [],
            encryptedSubject: sealed.encryptedSubject,
            encryptedBody: sealed.encryptedBody,
            wrappedKey: sealed.wrappedKey,
            attachments: metadata as Prisma.InputJsonValue,
            isRead: ruleResult?.markRead ?? options.markRead ?? false,
            isStarred: ruleResult?.star ?? options.markStarred ?? false,
            isDraft: options.isDraft ?? false,
            sentAt,
            receivedAt,
            sizeBytes: messageSize,
            spf,
            dkim,
            dmarc,
            category: classification.category,
            categories: classification.categories as Prisma.InputJsonValue,
            spamScore: options.targetFolderId ? null : spam.score,
            spamAction: options.targetFolderId ? null : spam.action ?? null,
            spamEngine: options.targetFolderId ? null : spam.engine ?? null,
            spamSymbols: (options.targetFolderId
              ? []
              : spam.symbols ?? []) as unknown as Prisma.InputJsonValue,
            trashedAt: trashed ? receivedAt : null,
            purgeAt: trashed ? new Date(receivedAt.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
            labels: ruleLabelIds.size
              ? { connect: Array.from(ruleLabelIds).map((id) => ({ id })) }
              : undefined,
          },
        });
        if (prepared.length > 0) {
          await tx.attachment.createMany({
            data: prepared.map((attachment) => ({
              userId,
              messageId: created.id,
              blobId: attachment.blobId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              encryptedKey: attachment.sealedKey,
              storagePath: attachment.storagePath,
              contentId: attachment.contentId,
              inline: attachment.inline,
            })),
          });
        }
        await tx.user.update({
          where: { id: userId },
          data: { storageUsedBytes: { increment: messageSize } },
        });
        return created;
      });

      await touchThread(threadId, sentAt);
      await collectContact(userId, fromEmail, parsed.from.name, ownAddresses).catch(() => undefined);

      result.delivered.push({
        userId,
        messageId: message.id,
        threadId,
        spam,
      });
    } catch (error) {
      for (const storagePath of writtenPaths) await deleteUpload(storagePath);
      const detail = error instanceof Error ? error.message : "unknown ingest failure";
      result.errors.push(`${recipient.address}: ${detail}`);
    }
  }

  return result;
}

export function plainTextPreview(html: string, text: string): string {
  return (stripHtml(html) || text).replace(/\s+/g, " ").slice(0, 240);
}
