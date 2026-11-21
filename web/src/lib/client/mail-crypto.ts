"use client";

import DOMPurify from "dompurify";
import {
  decryptAttachmentBytes,
  decryptMessage,
  encryptMessageForRecipients,
  unwrapMessageKey,
  decryptSubject,
  type KeyBundle,
} from "@nyxmail/crypto";
import type {
  ClientAttachmentMeta,
  DecryptedBody,
  EncryptedMessageDTO,
  PublicKeyLookup,
  SealedMessage,
} from "@nyxmail/shared";
import { formatAddress } from "@nyxmail/shared";
import { apiFetch, downloadAttachment } from "./api";

export interface DecryptedMail {
  dto: EncryptedMessageDTO;
  subject: string;
  body: DecryptedBody;
}

export async function decryptMail(
  message: EncryptedMessageDTO,
  bundle: KeyBundle,
): Promise<DecryptedMail> {
  const opened = await decryptMessage<Partial<DecryptedBody>>(
    message.encryptedSubject,
    message.encryptedBody,
    message.wrappedKey,
    bundle.privateKey,
    bundle.publicKey,
  );
  const attachments = Array.isArray(opened.payload.attachments)
    ? (opened.payload.attachments as ClientAttachmentMeta[])
    : [];
  return {
    dto: message,
    subject: opened.subject,
    body: {
      html: typeof opened.payload.html === "string" ? opened.payload.html : "",
      text: typeof opened.payload.text === "string" ? opened.payload.text : "",
      attachments,
    },
  };
}

export async function decryptMailSubject(
  message: EncryptedMessageDTO,
  bundle: KeyBundle,
): Promise<string> {
  return decryptSubject(
    message.encryptedSubject,
    message.wrappedKey,
    bundle.privateKey,
    bundle.publicKey,
  );
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 2_000);
}

/**
 * Build a small RFC822 sample from a decrypted message. It is only created
 * when the user explicitly reports spam or "not spam", and is sent to the
 * local Rspamd Bayes learner. Attachments are intentionally omitted; the
 * scanner already saw the full raw message during SMTP delivery.
 */
export async function buildTrainingSample(
  message: EncryptedMessageDTO,
  bundle: KeyBundle,
): Promise<string> {
  const mail = await decryptMail(message, bundle);
  const text = mail.body.text || plainTextFromHtml(mail.body.html);
  const html = mail.body.html || htmlFromPlainText(text);
  const boundary = `nyxmail-learn-${message.id.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const to = message.toAddresses.map(formatAddress).join(", ");
  const cc = message.ccAddresses.map(formatAddress).join(", ");
  const headers = [
    `From: ${headerValue(formatAddress({ email: message.fromAddress, name: message.fromName || undefined }))}`,
    `To: ${headerValue(to || "undisclosed-recipients:;")}`,
  ];
  if (cc) headers.push(`Cc: ${headerValue(cc)}`);
  headers.push(
    `Subject: ${headerValue(mail.subject || "(no subject)")}`,
    `Date: ${new Date(message.sentAt).toUTCString()}`,
    `Message-ID: ${headerValue(message.messageIdHeader || `<nyxmail-learn-${message.id}@localhost>`)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text.slice(0, 500_000),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html.slice(0, 500_000),
    `--${boundary}--`,
    "",
  );
  return headers.join("\r\n");
}

export async function unlockAttachmentKey(
  sealedKey: string,
  bundle: KeyBundle,
): Promise<string> {
  const { openAttachmentKey } = await import("@nyxmail/crypto");
  return openAttachmentKey(sealedKey, bundle.privateKey, bundle.publicKey);
}

export async function saveAttachment(
  attachment: ClientAttachmentMeta,
  bundle: KeyBundle,
): Promise<void> {
  const encrypted = await downloadAttachment(attachment.blobId);
  const plain = await decryptAttachmentBytes(new Uint8Array(encrypted), attachment.key);
  const blob = new Blob([plain as BlobPart], { type: attachment.mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachment.filename || "attachment";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function lookupRecipients(addresses: string[]): Promise<Map<string, PublicKeyLookup>> {
  const unique = Array.from(new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean)));
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

export interface ComposeCryptoOutput {
  sealed: SealedMessage;
  externalAddresses: string[];
  localRecipients: Map<string, PublicKeyLookup>;
}

export async function sealCompose(input: ComposeCryptoInput): Promise<ComposeCryptoOutput> {
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
}): Promise<SealedMessage> {
  const sealed = await encryptMessageForRecipients(
    input.subject || "(no subject)",
    { html: input.html, text: input.text, attachments: input.attachments },
    [{ address: input.accountEmail.toLowerCase(), publicKey: input.bundle.publicKey }],
  );
  return sealed;
}

export interface SanitizedEmail {
  html: string;
  hasRemoteImages: boolean;
  blockedImages: number;
}

function sanitizeCssStyles(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[style]"))) {
    const style = element.getAttribute("style") || "";
    if (/url\s*\(|@import|expression\s*\(|javascript:/i.test(style)) {
      element.removeAttribute("style");
    }
  }
}

export function sanitizeEmailHtml(
  html: string,
  allowRemoteImages: boolean,
  proxyBase = "",
): SanitizedEmail {
  const sanitized = DOMPurify.sanitize(html || "", {
    ALLOWED_TAGS: [
      "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "caption",
      "center", "cite", "code", "col", "colgroup", "dd", "del", "details", "div", "dl",
      "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4",
      "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark",
      "ol", "p", "pre", "q", "s", "section", "small", "span", "strike", "strong",
      "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
      "u", "ul",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "width", "height", "style", "class", "align",
      "valign", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "bgcolor",
      "color", "face", "size", "target", "rel", "id", "dir", "lang", "role", "aria-label",
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "base", "link", "meta", "svg", "math", "video", "audio", "source"],
    FORBID_ATTR: ["srcset", "formaction", "action", "ping", "http-equiv", "contenteditable"],
    KEEP_CONTENT: true,
  });

  const document = new DOMParser().parseFromString(sanitized, "text/html");
  sanitizeCssStyles(document);
  let hasRemoteImages = false;
  let blockedImages = 0;

  for (const image of Array.from(document.querySelectorAll("img"))) {
    const src = image.getAttribute("src") || "";
    if (/^data:image\/svg/i.test(src)) {
      image.removeAttribute("src");
      image.style.display = "none";
      continue;
    }
    const remoteSrc = src.startsWith("//") ? `https:${src}` : src;
    if (/^https?:\/\//i.test(remoteSrc)) {
      hasRemoteImages = true;
      image.setAttribute("referrerpolicy", "no-referrer");
      image.setAttribute("decoding", "async");
      if (allowRemoteImages) {
        // "Load once" must fetch immediately; lazy images inside a srcdoc
        // iframe can otherwise stay blank until the iframe is scrolled.
        image.setAttribute("loading", "eager");
        image.removeAttribute("data-blocked-src");
        image.style.removeProperty("display");
        image.setAttribute(
          "src",
          `${proxyBase}/api/v1/proxy/image?url=${encodeURIComponent(remoteSrc)}`,
        );
      } else {
        image.removeAttribute("src");
        image.setAttribute("data-blocked-src", remoteSrc);
        image.setAttribute("alt", image.getAttribute("alt") || "Remote image blocked");
        image.style.display = "none";
        blockedImages += 1;
      }
    }
  }

  for (const link of Array.from(document.querySelectorAll("a"))) {
    const href = link.getAttribute("href") || "";
    if (/^(javascript|data|vbscript):/i.test(href)) {
      link.removeAttribute("href");
    } else if (href) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }

  // Collapse top-level quotes into native details/summary so no scripts are
  // needed to expand them inside the sandboxed reader.
  for (const quote of Array.from(document.querySelectorAll("blockquote"))) {
    if (quote.closest("blockquote") !== quote) continue;
    if (quote.parentElement?.closest("details")) continue;
    const details = document.createElement("details");
    details.className = "nyx-quote";
    const summary = document.createElement("summary");
    summary.textContent = "Show quoted text";
    details.appendChild(summary);
    quote.replaceWith(details);
    details.appendChild(quote);
  }

  return {
    html: document.body.innerHTML,
    hasRemoteImages,
    blockedImages,
  };
}

export function buildEmailDocument(html: string, dark: boolean, origin = ""): string {
  const safeOrigin = /^https?:\/\/[^"'<>\s]+$/i.test(origin) ? origin.replace(/\/+$/, "") : "";
  const imageSources = ["'self'", "data:", "blob:", safeOrigin].filter(Boolean).join(" ");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="referrer" content="no-referrer" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imageSources}; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';" />
<style>
  :root { color-scheme: ${dark ? "dark" : "light"}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.68; color: ${dark ? "#E6EAF2" : "#1C2230"};
    overflow-wrap: anywhere; word-break: break-word; padding: 0 0 4px;
  }
  a { color: ${dark ? "#A78BFA" : "#5B3DF5"}; text-decoration: underline; text-underline-offset: 2px; }
  img { max-width: 100% !important; height: auto !important; border-radius: 4px; }
  table { max-width: 100% !important; border-collapse: collapse; }
  td, th { padding: 2px 6px; }
  blockquote { border-left: 3px solid ${dark ? "rgba(139,92,246,.35)" : "rgba(109,74,255,.35)"}; margin: 12px 0; padding-left: 12px; color: ${dark ? "#A6AFC2" : "#576074"}; }
  pre { white-space: pre-wrap; word-break: break-word; background: ${dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.035)"}; padding: 10px; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  hr { border: 0; border-top: 1px solid ${dark ? "#2A3240" : "#E4E8EF"}; margin: 18px 0; }
  details.nyx-quote { margin: 12px 0; }
  details.nyx-quote > summary { cursor: pointer; color: ${dark ? "#8B93A7" : "#5E6778"}; font-size: 12px; user-select: none; }
  details.nyx-quote[open] > summary { margin-bottom: 8px; }
  .nyx-signature { color: ${dark ? "#8B93A7" : "#5E6778"}; font-size: 13px; }
</style>
</head>
<body>${html}</body>
</html>`;
}

export function plainTextFromHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const br of Array.from(document.querySelectorAll("br"))) {
    br.replaceWith(document.createTextNode("\n"));
  }
  for (const block of Array.from(
    document.querySelectorAll("p, div, li, tr, blockquote, h1, h2, h3, h4, h5, h6, pre, hr"),
  )) {
    block.append(document.createTextNode("\n"));
  }
  return (document.body.textContent || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlFromPlainText(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, "<br>");
}

export function hasContent(input: { subject: string; html: string; recipients: string[]; attachments: unknown[] }): boolean {
  const text = plainTextFromHtml(input.html).trim();
  return Boolean(input.subject.trim() || text || input.recipients.length || input.attachments.length);
}
