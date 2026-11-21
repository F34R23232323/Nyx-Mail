"use client";

import JSZip from "jszip";
import { decryptAttachmentBytes, type KeyBundle } from "@nyxmail/crypto";
import type { ClientAttachmentMeta, DecryptedBody } from "@nyxmail/shared";
import { apiFetch, downloadAttachment } from "./api";
import { decryptMail } from "./mail-crypto";
import { downloadBlob } from "./utils";

interface ExportMessageRaw {
  id: string;
  threadId: string;
  folderId: string;
  folderType: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  encryptedSubject: string;
  encryptedBody: string;
  wrappedKey: string;
  sentAt: string;
  isRead: boolean;
  isStarred: boolean;
}

interface ExportMessage {
  from: string;
  to: string[];
  subject: string;
  date: Date;
  html: string;
  text: string;
  attachments: Array<{ filename: string; mimeType: string; content: Uint8Array; contentId?: string | null }>;
  messageId: string;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, 2000);
}

function base64(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function wrapBase64(value: string, width = 76): string {
  return value.match(new RegExp(`.{1,${width}}`, "g"))?.join("\r\n") ?? value;
}

function buildMime(message: ExportMessage): string {
  const boundary = `nyxmail-${crypto.randomUUID()}`;
  const lines: string[] = [
    `From: ${sanitizeHeader(message.from)}`,
    `To: ${sanitizeHeader(message.to.join(", "))}`,
    `Subject: ${sanitizeHeader(message.subject)}`,
    `Date: ${message.date.toUTCString()}`,
    `Message-ID: <${message.messageId}@nyxmail.export>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: multipart/alternative; boundary="alt-' + boundary + '"',
    "",
    `--alt-${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64(message.text || message.html.replace(/<[^>]+>/g, " "))),
    "",
    `--alt-${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64(message.html)),
    "",
    `--alt-${boundary}--`,
    "",
  ];
  for (const attachment of message.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${sanitizeHeader(attachment.mimeType)}; name="${sanitizeHeader(attachment.filename)}"`,
      `Content-Disposition: attachment; filename="${sanitizeHeader(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(base64(attachment.content)),
      "",
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

async function collectMessages(
  bundle: KeyBundle,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportMessage[]> {
  const raw = await apiFetch<{ messages: ExportMessageRaw[] }>(
    "/api/v1/messages/search-index?limit=5000",
  );
  const messages: ExportMessage[] = [];
  let done = 0;
  for (const item of raw.messages) {
    if (item.folderType === "TRASH") {
      done += 1;
      continue;
    }
    try {
      const decrypted = await decryptMail(
        {
          id: item.id,
          threadId: item.threadId,
          folderId: item.folderId,
          folderType: "INBOX",
          fromAddress: item.fromAddress,
          fromName: item.fromName,
          toAddresses: item.toAddresses.map((email) => ({ email })),
          ccAddresses: [],
          bccAddresses: [],
          encryptedSubject: item.encryptedSubject,
          encryptedBody: item.encryptedBody,
          wrappedKey: item.wrappedKey,
          attachments: [],
          messageIdHeader: null,
          inReplyTo: null,
          references: [],
          isRead: item.isRead,
          isStarred: item.isStarred,
          isDraft: false,
          sentAt: item.sentAt,
          receivedAt: item.sentAt,
          sizeBytes: 0,
          spf: null,
          dkim: null,
          dmarc: null,
          snoozeUntil: null,
          labels: [],
        },
        bundle,
      );
      const attachments: ExportMessage["attachments"] = [];
      for (const attachment of decrypted.body.attachments) {
        try {
          const encrypted = await downloadAttachment(attachment.blobId);
          const plain = await decryptAttachmentBytes(new Uint8Array(encrypted), attachment.key);
          attachments.push({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            content: plain,
            contentId: attachment.contentId,
          });
        } catch {
          // Skip an attachment that cannot be decrypted rather than aborting
          // the entire export.
        }
      }
      messages.push({
        from: item.fromName ? `${item.fromName} <${item.fromAddress}>` : item.fromAddress,
        to: item.toAddresses,
        subject: decrypted.subject,
        date: new Date(item.sentAt),
        html: decrypted.body.html,
        text: decrypted.body.text,
        attachments,
        messageId: item.id,
      });
    } catch {
      // Skip messages encrypted to a key we do not hold.
    }
    done += 1;
    if (done % 10 === 0 || done === raw.messages.length) onProgress?.(done, raw.messages.length);
  }
  return messages;
}

export async function exportMbox(
  bundle: KeyBundle,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const messages = await collectMessages(bundle, onProgress);
  const chunks: string[] = [];
  for (const message of messages) {
    const eml = buildMime(message);
    const escaped = eml.replace(/^From /gm, ">From ");
    chunks.push(`From - ${message.date.toUTCString()}\n${escaped}\n`);
  }
  downloadBlob(
    new Blob([chunks.join("\n")], { type: "application/mbox" }),
    `nyxmail-export-${new Date().toISOString().slice(0, 10)}.mbox`,
  );
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 100) || "message";
}

export async function exportEmlZip(
  bundle: KeyBundle,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const messages = await collectMessages(bundle, onProgress);
  const zip = new JSZip();
  messages.forEach((message, index) => {
    const date = message.date.toISOString().slice(0, 10);
    zip.file(
      `${date}-${String(index + 1).padStart(4, "0")}-${safeFilename(message.subject)}.eml`,
      buildMime(message),
    );
  });
  zip.file(
    "README.txt",
    "NyxMail mailbox export\nMessages and attachments were decrypted locally in your browser.\n",
  );
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  downloadBlob(blob, `nyxmail-export-${new Date().toISOString().slice(0, 10)}.zip`);
}

export function downloadPublicKey(publicKey: string, signingPublicKey: string): void {
  const content = `NyxMail public key bundle
Public encryption key (X25519): ${publicKey}
Public signing key (Ed25519): ${signingPublicKey}
`;
  downloadBlob(new Blob([content], { type: "text/plain" }), "nyxmail-public-keys.txt");
}
