import { simpleParser, type ParsedMail } from "mailparser";
import type { Address } from "@nyxmail/shared";
import { isEmail, normalizeEmail, parseAddressHeader } from "@nyxmail/shared";

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
  contentId: string | null;
  inline: boolean;
}

export interface ParsedMessage {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  html: string;
  date: Date;
  attachments: ParsedAttachment[];
  headers: Record<string, string>;
  received: string[];
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

export interface AuthResultValues {
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

function firstHeader(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return typeof value === "string" ? value : "";
}

function normalizeMessageId(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeReferences(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
  const matches = raw.match(/<[^>]+>/g);
  return matches ? matches.map((ref) => ref.trim()) : [];
}

function addressFromMailbox(mailbox: ParsedMail["from"]): Address {
  const first = mailbox?.value?.[0];
  return {
    name: first?.name || undefined,
    email: normalizeEmail(first?.address || ""),
  };
}

export function parseAuthResults(text: string | undefined): AuthResultValues {
  if (!text) return {};
  const values: AuthResultValues = {};
  for (const mechanism of ["spf", "dkim", "dmarc"] as const) {
    const match = new RegExp(`\\b${mechanism}\\s*=\\s*(pass|fail|softfail|neutral|none|error)\\b`, "i").exec(text);
    if (match) values[mechanism] = match[1].toLowerCase();
  }
  return values;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseEml(raw: Buffer | string): Promise<ParsedMessage> {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (buffer.length === 0) throw new Error("Empty message");
  if (buffer.length > 60 * 1024 * 1024) throw new Error("Message exceeds 60MB limit");
  const parsed = await simpleParser(buffer, { skipHtmlToText: true, skipTextToHtml: true });
  const rawHeaders = parsed.headers as Map<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [key, value] of rawHeaders.entries()) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
  }
  const received = parsed.headerLines
    .filter((line) => line.key.toLowerCase() === "received")
    .map((line) => line.line.replace(/^received:\s*/i, ""));
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const text = typeof parsed.text === "string" ? parsed.text : htmlToText(html);
  const auth = parseAuthResults(
    firstHeader(rawHeaders.get("authentication-results")) || headers["authentication-results"],
  );
  const attachments = parsed.attachments.map((attachment) => ({
    filename: attachment.filename || "attachment",
    mimeType: attachment.contentType || "application/octet-stream",
    content: attachment.content,
    contentId: attachment.cid ? attachment.cid.replace(/^<|>$/g, "") : null,
    inline: attachment.contentDisposition === "inline",
  }));
  return {
    messageId: normalizeMessageId(parsed.messageId),
    inReplyTo: normalizeMessageId(firstHeader(rawHeaders.get("in-reply-to")) || parsed.inReplyTo),
    references: normalizeReferences(parsed.references),
    from: addressFromMailbox(parsed.from),
    to: parseAddressHeader(
      Array.isArray(parsed.to)
        ? parsed.to.map((a) => a.text).join(", ")
        : parsed.to?.text ?? "",
    ),
    cc: parseAddressHeader(
      Array.isArray(parsed.cc)
        ? parsed.cc.map((a) => a.text).join(", ")
        : parsed.cc?.text ?? "",
    ),
    bcc: parseAddressHeader(
      Array.isArray(parsed.bcc)
        ? parsed.bcc.map((a) => a.text).join(", ")
        : parsed.bcc?.text ?? "",
    ),
    subject: parsed.subject?.trim() || "(no subject)",
    text,
    html,
    date: parsed.date instanceof Date && !Number.isNaN(parsed.date.valueOf()) ? parsed.date : new Date(),
    attachments,
    headers,
    received,
    spf: auth.spf,
    dkim: auth.dkim,
    dmarc: auth.dmarc,
  };
}

/**
 * Split mboxrd content. Unescapes ">From " at line starts, per mboxrd.
 */
export function splitMbox(content: Buffer | string): Buffer[] {
  const raw = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const chunks: string[][] = [];
  let current: string[] | null = null;
  let sawSeparator = false;

  for (const line of lines) {
    if (/^From .+/.test(line)) {
      if (current && current.length > 0) chunks.push(current);
      current = [];
      sawSeparator = true;
    } else if (current) {
      current.push(line.replace(/^>From /, "From "));
    }
  }
  if (current && current.length > 0) chunks.push(current);
  if (!sawSeparator && normalized.trim()) chunks.push(normalized.split("\n"));
  return chunks
    .map((chunk) => chunk.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""))
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => Buffer.from(`${chunk}\n`, "utf8"));
}

export async function* parseMbox(content: Buffer | string): AsyncGenerator<ParsedMessage> {
  for (const chunk of splitMbox(content)) {
    yield parseEml(chunk);
  }
}

export async function parseMboxToArray(content: Buffer | string): Promise<ParsedMessage[]> {
  const messages: ParsedMessage[] = [];
  for await (const message of parseMbox(content)) messages.push(message);
  return messages;
}

export function extractSenderIp(received: string[]): string | null {
  for (const line of received) {
    const matches = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
    if (!matches) continue;
    for (const ip of matches) {
      if (!/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip)) {
        return ip;
      }
    }
  }
  return null;
}

export function isPlausibleEmail(value: string): boolean {
  return isEmail(normalizeEmail(value));
}
