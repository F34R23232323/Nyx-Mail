export type FolderType = "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "SPAM" | "TRASH" | "CUSTOM";

export interface Address {
  name?: string;
  email: string;
}

export interface AttachmentMeta {
  id?: string;
  blobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string | null;
  inline?: boolean;
}

export interface ClientAttachmentMeta extends AttachmentMeta {
  key: string;
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
}

export interface ThreadDTO {
  id: string;
  lastActivityAt: string;
  messageCount: number;
  unreadCount: number;
  labels: LabelDTO[];
  latest: EncryptedMessageDTO;
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

export interface AliasDTO {
  id: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export interface ContactDTO {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface GmailAccountDTO {
  id: string;
  googleEmail: string;
  enabled: boolean;
  lastSyncAt: string | null;
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

export interface PublicKeyLookup {
  address: string;
  publicKey: string;
  local: true;
}

export interface KeyBundleResponse {
  encryptedPrivateKey: string;
  argonSalt: string;
  publicKey: string;
  signingPublicKey: string;
}

export interface Paginated<T> {
  items: T[];
  nextPage: number | null;
  total?: number;
}

export interface DecryptedMail {
  dto: EncryptedMessageDTO;
  subject: string;
  body: {
    html: string;
    text: string;
    attachments: ClientAttachmentMeta[];
  };
}

export interface ComposeAddress {
  name?: string;
  email: string;
}
