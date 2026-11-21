import type { AutoFilterId, MessageCategory } from "./categories";

export const FOLDER_TYPES = [
  "INBOX",
  "SENT",
  "DRAFTS",
  "ARCHIVE",
  "SPAM",
  "TRASH",
  "CUSTOM",
] as const;

export type FolderType = (typeof FOLDER_TYPES)[number];

export const IMPORT_SOURCES = ["GMAIL", "IMAP", "PROTON", "MBOX", "EML"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export type ImportStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type FilterKind = "BLOCK" | "ALLOW";

export interface Address {
  name?: string;
  email: string;
}

export interface AttachmentMeta {
  id: string;
  blobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string | null;
  inline?: boolean;
}

export interface ClientAttachmentMeta extends AttachmentMeta {
  /** Base64 XChaCha20 key. Never sent to the server outside ciphertext. */
  key: string;
}

export interface DecryptedBody {
  html: string;
  text: string;
  attachments: ClientAttachmentMeta[];
}

export interface SealedMessage {
  encryptedSubject: string;
  encryptedBody: string;
  /** address (lowercase) -> base64 crypto_box_seal(messageKey, recipient public key) */
  wraps: Record<string, string>;
  sizeBytes: number;
}

export type SpamAction =
  | "no action"
  | "greylist"
  | "add header"
  | "rewrite subject"
  | "soft reject"
  | "reject"
  | string;

export interface SpamSymbolHit {
  name: string;
  score: number;
  options?: string[];
  group?: string;
  description?: string;
}

export type SpamEngine = "rspamd" | "local" | "filter";

export interface EncryptedMessageDTO {
  id: string;
  userId?: string;
  threadId: string;
  folderId: string;
  folderType: FolderType;
  fromAddress: string;
  fromName: string | null;
  toAddresses: Address[];
  ccAddresses: Address[];
  bccAddresses: Address[];
  encryptedSubject: string;
  encryptedBody: string;
  wrappedKey: string;
  attachments: AttachmentMeta[];
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string[];
  isRead: boolean;
  isStarred: boolean;
  isDraft: boolean;
  sentAt: string;
  receivedAt: string;
  sizeBytes: number;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  snoozeUntil: string | null;
  labels: LabelDTO[];
  hasRemoteImages?: boolean;
  /** Broad automatic category, e.g. TRANSACTIONS. */
  category?: MessageCategory;
  /** Automatic built-in filters that matched, e.g. BILLING + SHIPPING. */
  categories?: AutoFilterId[];
  /** Rspamd/fallback score captured at delivery time. */
  spamScore?: number | null;
  spamAction?: SpamAction | null;
  spamEngine?: SpamEngine | null;
  spamSymbols?: SpamSymbolHit[];
}

export interface LabelDTO {
  id: string;
  name: string;
  color: string;
}

export interface FolderDTO {
  id: string;
  name: string;
  type: FolderType;
  order: number;
  unreadCount?: number;
}

export interface ThreadDTO {
  id: string;
  lastActivityAt: string;
  messageCount: number;
  unreadCount: number;
  labels: LabelDTO[];
  latest: EncryptedMessageDTO;
}

export interface ContactDTO {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AliasDTO {
  id: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export interface SessionDTO {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  recoveryEmail: string | null;
  signatureText: string | null;
  signatureHtml: string | null;
  totpEnabled: boolean;
  backupCodesRemaining: number;
  passkeyCount: number;
  storageUsedBytes: number;
  storageLimitBytes: number;
  publicKey: string;
  signingPublicKey: string;
  createdAt: string;
}

export interface KeyBundleResponse {
  encryptedPrivateKey: string;
  argonSalt: string;
  publicKey: string;
  signingPublicKey: string;
}

export interface PublicKeyLookup {
  address: string;
  publicKey: string;
  local: true;
}

export interface ImportJobDTO {
  id: string;
  source: ImportSource;
  status: ImportStatus;
  progressMessages: number;
  totalMessages: number;
  cursor: string | null;
  errors: string[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  folderMapping: Record<string, string>;
  meta?: Record<string, string | number | boolean | null>;
}

export interface IngestAuthResults {
  spf?: "pass" | "fail" | "softfail" | "neutral" | "none";
  dkim?: "pass" | "fail" | "none";
  dmarc?: "pass" | "fail" | "none";
}

export interface IngestPayload {
  envelopeFrom: string;
  envelopeTo: string[];
  rawMimeBase64: string;
  authResults?: IngestAuthResults;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export interface MailListQuery {
  folder?: string;
  label?: string;
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface WsEvent {
  type: "mail" | "unread" | "import" | "ping";
  unread?: number;
  threadId?: string;
  importJobId?: string;
  status?: ImportStatus;
}

export interface SearchIndexItem {
  id: string;
  threadId: string;
  folderId: string;
  folderType: FolderType;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  date: number;
  isRead: boolean;
  isStarred: boolean;
}

export interface Paginated<T> {
  items: T[];
  nextPage: number | null;
  total?: number;
}

export interface SendMessageInput {
  fromAddress: string;
  /** Connected Gmail account to send external mail through. */
  gmailAccountId?: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  sealed: SealedMessage;
  draftId?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  scheduledFor?: string | null;
  /** Required if at least one envelope recipient is external. Plaintext is
   * held in memory only for SMTP relay (or encrypted at rest for scheduled
   * sends) and never written to the mailbox. */
  relay?: {
    subject: string;
    html: string;
    text: string;
    attachmentKeys?: Record<string, string>;
  } | null;
  attachments: Array<{
    blobId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentId?: string | null;
    inline?: boolean;
  }>;
}

export interface AccountUpdateInput {
  displayName?: string;
  recoveryEmail?: string | null;
  signatureText?: string | null;
  signatureHtml?: string | null;
}

export interface DraftInput {
  id?: string | null;
  fromAddress: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  sealed: SealedMessage;
  attachments: Array<{
    blobId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentId?: string | null;
    inline?: boolean;
  }>;
  inReplyTo?: string | null;
  references?: string[];
  threadId?: string | null;
}

export interface SpamCheckResult {
  spam: boolean;
  score: number;
  reasons: string[];
  engine?: SpamEngine;
  action?: SpamAction;
  requiredScore?: number;
  symbols?: SpamSymbolHit[];
  learned?: boolean;
}
