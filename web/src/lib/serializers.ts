import type {
  Alias,
  Attachment,
  Contact,
  Folder,
  ImportJob,
  Label,
  MailRule,
  Message,
  Session,
  Thread,
  User,
} from "@nyxmail/db";
import { jsonStringArray } from "@nyxmail/db";
import { isRuleExpression } from "@nyxmail/shared";
import type {
  Address,
  AliasDTO,
  AttachmentMeta,
  AutoFilterId,
  ContactDTO,
  EncryptedMessageDTO,
  FolderDTO,
  FolderType,
  ImportJobDTO,
  LabelDTO,
  MessageCategory,
  SessionDTO,
  SpamAction,
  SpamEngine,
  SpamSymbolHit,
  ThreadDTO,
  UserDTO,
  MailRuleDTO,
  RuleAction,
  RuleCondition,
  RuleMatchType,
} from "@nyxmail/shared";
import { isAutoFilterId, isMessageCategory } from "@nyxmail/shared";

type MessageWithRelations = Message & {
  folder: Folder;
  labels: Label[];
  attachmentRows: Attachment[];
};

function date(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function autoFilterIds(value: unknown): AutoFilterId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isAutoFilterId)));
}

function spamSymbolHits(value: unknown): SpamSymbolHit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string",
    )
    .map((item) => ({
      name: String(item.name),
      score: Number(item.score) || 0,
      ...(Array.isArray(item.options)
        ? { options: item.options.filter((option): option is string => typeof option === "string") }
        : {}),
      ...(typeof item.group === "string" ? { group: item.group } : {}),
      ...(typeof item.description === "string" ? { description: item.description } : {}),
    }))
    .slice(0, 100);
}

function addresses(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Address =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as Address).email === "string",
    )
    .map((item) => ({ email: item.email, name: item.name }));
}

export function labelToDTO(label: Label): LabelDTO {
  return { id: label.id, name: label.name, color: label.color };
}

export function attachmentToMeta(attachment: Attachment): AttachmentMeta {
  return {
    id: attachment.id,
    blobId: attachment.blobId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    contentId: attachment.contentId,
    inline: attachment.inline,
  };
}

export function messageToDTO(message: MessageWithRelations): EncryptedMessageDTO {
  const attachmentRows = message.attachmentRows ?? [];
  const attachmentMeta: AttachmentMeta[] =
    attachmentRows.length > 0
      ? attachmentRows.map(attachmentToMeta)
      : Array.isArray(message.attachments)
        ? (message.attachments as Array<Record<string, unknown>>)
            .filter((item) => typeof item?.blobId === "string")
            .map((item) => ({
              id: String(item.blobId),
              blobId: String(item.blobId),
              filename: String(item.filename ?? "attachment"),
              mimeType: String(item.mimeType ?? "application/octet-stream"),
              sizeBytes: Number(item.sizeBytes ?? 0),
              contentId: typeof item.contentId === "string" ? item.contentId : null,
              inline: Boolean(item.inline),
            }))
        : [];
  return {
    id: message.id,
    threadId: message.threadId,
    folderId: message.folderId,
    folderType: message.folder.type,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    toAddresses: addresses(message.toAddresses),
    ccAddresses: addresses(message.ccAddresses),
    bccAddresses: addresses(message.bccAddresses),
    encryptedSubject: message.encryptedSubject,
    encryptedBody: message.encryptedBody,
    wrappedKey: message.wrappedKey,
    attachments: attachmentMeta,
    messageIdHeader: message.messageIdHeader,
    inReplyTo: message.inReplyTo,
    references: jsonStringArray(message.references),
    isRead: message.isRead,
    isStarred: message.isStarred,
    isDraft: message.isDraft,
    sentAt: message.sentAt.toISOString(),
    receivedAt: message.receivedAt.toISOString(),
    sizeBytes: message.sizeBytes,
    spf: message.spf,
    dkim: message.dkim,
    dmarc: message.dmarc,
    snoozeUntil: date(message.snoozeUntil),
    labels: (message.labels ?? []).map(labelToDTO),
    category: isMessageCategory(message.category) ? message.category : "PRIMARY",
    categories: autoFilterIds(message.categories),
    spamScore: typeof message.spamScore === "number" ? message.spamScore : null,
    spamAction: (message.spamAction as SpamAction | null) ?? null,
    spamEngine:
      message.spamEngine === "rspamd" || message.spamEngine === "local" || message.spamEngine === "filter"
        ? (message.spamEngine as SpamEngine)
        : null,
    spamSymbols: spamSymbolHits(message.spamSymbols),
  };
}

export function threadToDTO(
  thread: Thread & { messages: MessageWithRelations[]; unreadCount?: number },
): ThreadDTO {
  const latest = thread.messages[0];
  if (!latest) throw new Error("Thread has no messages");
  const labels = new Map<string, LabelDTO>();
  for (const message of thread.messages) {
    for (const label of message.labels) labels.set(label.id, labelToDTO(label));
  }
  return {
    id: thread.id,
    lastActivityAt: thread.lastActivityAt.toISOString(),
    messageCount: thread.messageCount || thread.messages.length,
    unreadCount: thread.unreadCount ?? thread.messages.filter((message) => !message.isRead).length,
    labels: Array.from(labels.values()),
    latest: messageToDTO(latest),
  };
}

export function folderToDTO(folder: Folder): FolderDTO {
  return {
    id: folder.id,
    name: folder.name,
    type: folder.type as FolderType,
    order: folder.order,
  };
}

export function contactToDTO(contact: Contact): ContactDTO {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    createdAt: contact.createdAt.toISOString(),
  };
}

export function aliasToDTO(alias: Alias): AliasDTO {
  return {
    id: alias.id,
    address: alias.address,
    active: alias.active,
    createdAt: alias.createdAt.toISOString(),
  };
}

export function sessionToDTO(session: Session, currentSessionId?: string): SessionDTO {
  return {
    id: session.id,
    ip: session.ip,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    current: session.id === currentSessionId,
  };
}

export function userToDTO(
  user: User,
  extras: { storageUsedBytes?: number; backupCodesRemaining?: number; passkeyCount?: number } = {},
): UserDTO {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    recoveryEmail: user.recoveryEmail,
    signatureText: user.signatureText,
    signatureHtml: user.signatureHtml,
    totpEnabled: user.totpEnabled,
    backupCodesRemaining:
      extras.backupCodesRemaining ?? jsonStringArray(user.backupCodes).length,
    passkeyCount:
      extras.passkeyCount ?? (Array.isArray(user.webauthnCredentials) ? user.webauthnCredentials.length : 0),
    storageUsedBytes: extras.storageUsedBytes ?? user.storageUsedBytes,
    storageLimitBytes: user.storageLimitBytes,
    publicKey: user.publicKey,
    signingPublicKey: user.signingPublicKey,
    createdAt: user.createdAt.toISOString(),
  };
}

function importMeta(value: unknown): ImportJobDTO["meta"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ImportJobDTO["meta"];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function importToDTO(job: ImportJob): ImportJobDTO {
  return {
    id: job.id,
    source: job.source,
    status: job.status,
    progressMessages: job.progressMessages,
    totalMessages: job.totalMessages,
    cursor: job.cursor,
    errors: stringArray(job.errors),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: date(job.startedAt),
    completedAt: date(job.completedAt),
    folderMapping:
      job.folderMapping && typeof job.folderMapping === "object" && !Array.isArray(job.folderMapping)
        ? (job.folderMapping as Record<string, string>)
        : {},
    meta: importMeta(job.meta),
  };
}


export function mailRuleToDTO(rule: MailRule): MailRuleDTO {
  const conditions = Array.isArray(rule.conditions) ? (rule.conditions as unknown as RuleCondition[]) : [];
  const actions = Array.isArray(rule.actions) ? (rule.actions as unknown as RuleAction[]) : [];
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    mode: rule.mode === "SIEVE" ? "SIEVE" : "VISUAL",
    priority: rule.priority,
    matchType: rule.matchType as RuleMatchType,
    conditions,
    expression: isRuleExpression(rule.expression) ? rule.expression : null,
    actions,
    sieveScript: rule.sieveScript ?? null,
    stopProcessing: rule.stopProcessing,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}
