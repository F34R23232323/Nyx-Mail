import {
  apiFetch,
  downloadAttachment,
  uploadEncryptedAttachment,
} from "./api";
import {
  decryptAttachmentBytes,
  decryptMessage,
  encryptAttachmentBytes,
  encryptMessageForRecipients,
  type ClientAttachmentMeta,
  type KeyBundle,
  type SealedPayload,
} from "./crypto";
import type {
  Address,
  AttachmentMeta,
  ComposeAddress,
  DecryptedMail,
  EncryptedMessageDTO,
  PublicKeyLookup,
} from "./types";
import { escapeHtml, htmlToText, isEmail, isLocalOnlyAddress } from "./format";

export async function decryptMail(
  message: EncryptedMessageDTO,
  bundle: KeyBundle,
): Promise<DecryptedMail> {
  try {
    const opened = await decryptMessage<{
      html?: string;
      text?: string;
      attachments?: ClientAttachmentMeta[];
    }>(
      message.encryptedSubject,
      message.encryptedBody,
      message.wrappedKey,
      bundle.privateKey,
      bundle.publicKey,
    );
    const attachments = Array.isArray(opened.payload.attachments)
      ? opened.payload.attachments
      : [];
    return {
      dto: message,
      subject: opened.subject || "(no subject)",
      body: {
        html: typeof opened.payload.html === "string" ? opened.payload.html : "",
        text: typeof opened.payload.text === "string" ? opened.payload.text : "",
        attachments,
      },
    };
  } catch {
    return {
      dto: message,
      subject: "Encrypted message",
      body: {
        html: "",
        text: "This message could not be decrypted with the key on this device.",
        attachments: [],
      },
    };
  }
}

export async function decryptMailSubject(
  message: EncryptedMessageDTO,
  bundle: KeyBundle,
): Promise<string> {
  try {
    const opened = await decryptMessage(
      message.encryptedSubject,
      message.encryptedBody,
      message.wrappedKey,
      bundle.privateKey,
      bundle.publicKey,
    );
    return opened.subject || "(no subject)";
  } catch {
    return "Encrypted message";
  }
}

export async function lookupRecipients(
  addresses: string[],
): Promise<Map<string, PublicKeyLookup>> {
  const unique = Array.from(
    new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean)),
  );
  if (unique.length === 0) return new Map();
  const data = await apiFetch<{ recipients: PublicKeyLookup[] }>(
    `/api/v1/keys?addresses=${encodeURIComponent(unique.join(","))}`,
  );
  return new Map(data.recipients.map((recipient) => [recipient.address.toLowerCase(), recipient]));
}

export interface ComposeCryptoInput {
  subject: string;
  html: string;
  text: string;
  attachments: ClientAttachmentMeta[];
  fromAddress: string;
  accountEmail: string;
  recipientAddresses: string[];
  bundle: KeyBundle;
}

export async function sealCompose(input: ComposeCryptoInput): Promise<{
  sealed: SealedPayload;
  externalAddresses: string[];
  localRecipients: Map<string, PublicKeyLookup>;
}> {
  const local = await lookupRecipients(input.recipientAddresses);
  const externalAddresses = input.recipientAddresses.filter(
    (address) => !local.has(address.toLowerCase()),
  );
  const recipients = new Map<string, string>();
  recipients.set(input.accountEmail.toLowerCase(), input.bundle.publicKey);
  recipients.set(input.fromAddress.toLowerCase(), input.bundle.publicKey);
  for (const address of input.recipientAddresses) {
    const key = local.get(address.toLowerCase());
    if (key) recipients.set(address.toLowerCase(), key.publicKey);
  }
  const sealed = await encryptMessageForRecipients(
    input.subject || "(no subject)",
    {
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    },
    Array.from(recipients.entries()).map(([address, publicKey]) => ({ address, publicKey })),
  );
  return { sealed, externalAddresses, localRecipients: local };
}

export async function sealDraft(input: {
  subject: string;
  html: string;
  text: string;
  attachments: ClientAttachmentMeta[];
  bundle: KeyBundle;
  accountEmail: string;
}): Promise<SealedPayload> {
  return encryptMessageForRecipients(
    input.subject || "(no subject)",
    { html: input.html, text: input.text, attachments: input.attachments },
    [{ address: input.accountEmail.toLowerCase(), publicKey: input.bundle.publicKey }],
  );
}

export async function uploadAttachmentFromUri(input: {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}): Promise<ClientAttachmentMeta> {
  const FileSystem = await import("expo-file-system/legacy");
  const base64 = await FileSystem.readAsStringAsync(input.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decodeBase64(base64);
  if (bytes.length > 25 * 1024 * 1024) throw new Error(`${input.name} is larger than 25MB`);
  const encrypted = encryptAttachmentBytes(bytes);
  const uploaded = await uploadEncryptedAttachment({
    ciphertext: encrypted.ciphertext,
    filename: input.name,
    mimeType: input.mimeType || "application/octet-stream",
    sizeBytes: bytes.length,
  });
  return {
    id: uploaded.attachment.blobId,
    blobId: uploaded.attachment.blobId,
    filename: input.name,
    mimeType: input.mimeType || "application/octet-stream",
    sizeBytes: bytes.length,
    key: encrypted.key,
    contentId: null,
    inline: false,
  };
}

export async function saveAttachmentToCache(
  attachment: ClientAttachmentMeta | AttachmentMeta,
  key: string,
): Promise<{ uri: string; filename: string; mimeType: string }> {
  const FileSystem = await import("expo-file-system/legacy");
  const encrypted = await downloadAttachment(attachment.blobId);
  const plain = decryptAttachmentBytes(encrypted, key);
  const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]+/g, "_") || "attachment";
  const directory = `${FileSystem.cacheDirectory}nyxmail-share/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
  const uri = `${directory}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, encodeBase64(plain), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { uri, filename: safeName, mimeType: attachment.mimeType };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    out += B64[(triplet >> 18) & 63];
    out += B64[(triplet >> 12) & 63];
    out += index + 1 < bytes.length ? B64[(triplet >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? B64[triplet & 63] : "=";
  }
  return out;
}

export function decodeBase64(value: string): Uint8Array {
  const cleaned = value.replace(/\s+/g, "");
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (char === "=") break;
    const decoded = B64.indexOf(char);
    if (decoded < 0) throw new Error("Invalid base64");
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

export function preferredSender(
  email: string,
  aliases: { address: string; active: boolean }[],
  extraAddresses: string[] = [],
): string {
  const candidates = Array.from(
    new Set([
      email,
      ...aliases.filter((alias) => alias.active).map((alias) => alias.address),
      ...extraAddresses,
    ]),
  );
  return candidates.find((address) => !isLocalOnlyAddress(address)) ?? candidates[0];
}

export function signatureHtml(user: {
  displayName: string;
  email: string;
  signatureText: string | null;
  signatureHtml: string | null;
}): string {
  if (user.signatureText?.trim()) {
    return `<div style="color:#8B93A7;font-size:13px;margin-top:18px">--<br>${escapeHtml(
      user.signatureText.trim(),
    ).replace(/\n/g, "<br>")}</div>`;
  }
  if (user.signatureHtml?.trim()) {
    return `<div style="color:#8B93A7;font-size:13px;margin-top:18px">${user.signatureHtml}</div>`;
  }
  return "";
}

export function replySubject(subject: string, mode: "reply" | "replyAll" | "forward" | "new"): string {
  const clean = subject.trim();
  if (mode === "reply" || mode === "replyAll") {
    return /^re\s*:/i.test(clean) ? clean : `Re: ${clean || "(no subject)"}`;
  }
  if (mode === "forward") {
    return /^fwd?\s*:/i.test(clean) ? clean : `Fwd: ${clean || "(no subject)"}`;
  }
  return clean;
}

export function quoteForward(mail: DecryptedMail): string {
  const header = [
    "---------- Forwarded message ----------",
    `From: ${mail.dto.fromName || ""} <${mail.dto.fromAddress}>`,
    `Date: ${new Date(mail.dto.sentAt).toLocaleString()}`,
    `Subject: ${mail.subject}`,
    `To: ${mail.dto.toAddresses.map((address) => address.email).join(", ")}`,
  ].join("<br>");
  const body = mail.body.html || escapeHtml(mail.body.text).replace(/\n/g, "<br>");
  return `<p><br></p><div style="color:#8B93A7;font-size:12px">${header}</div><br>${body}`;
}

export function quoteReply(mail: DecryptedMail): string {
  const body = mail.body.html || escapeHtml(mail.body.text).replace(/\n/g, "<br>");
  return `<p><br></p><div style="color:#8B93A7;font-size:12px">On ${new Date(
    mail.dto.sentAt,
  ).toLocaleString()}, ${mail.dto.fromName || mail.dto.fromAddress} wrote:</div><blockquote style="margin:10px 0 0;padding-left:12px;border-left:2px solid #333">${body}</blockquote>`;
}

export function addressesFromMail(value: string): ComposeAddress[] {
  return value
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*)<([^>]+)>$/.exec(part);
      if (match) {
        const name = match[1].trim().replace(/^"|"$/g, "");
        return { name: name || undefined, email: match[2].trim().toLowerCase() };
      }
      return { email: part.toLowerCase() };
    })
    .filter((address) => isEmail(address.email));
}

export function toRecipientEmails(addresses: Address[]): string[] {
  return addresses.map((address) => address.email).filter(Boolean);
}

export function buildQuotedHtml(html: string): string {
  return htmlToText(html);
}
