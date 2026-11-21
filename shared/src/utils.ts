import type { Address } from "./types";

// Domain labels may be a single label in self-hosted/local development
// (for example demo@localhost), so the TLD dot is optional but labels are
// still strictly validated.
export const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : normalizeEmail(email.slice(at + 1));
}

export function localPartOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

export function isLocalAddress(email: string, mailDomain: string): boolean {
  return domainOf(email) === normalizeEmail(mailDomain);
}

export function normalizeAddress(input: string | Address): Address {
  if (typeof input === "string") {
    return { email: normalizeEmail(input) };
  }
  return { name: input.name?.trim() || undefined, email: normalizeEmail(input.email) };
}

export function addressKey(address: string): string {
  return normalizeEmail(address);
}

export function formatAddress(address: Address): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

export function parseAddressHeader(value: string | string[] | undefined | null): Address[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(", ") : value;
  const results: Address[] = [];
  // Handles "Name <a@b>, c@d" including quoted display names.
  const re = /("([^"]*)"|([^<,]+))?\s*<([^>]+)>|([^\s<>,]+@[^\s<>,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const email = normalizeEmail(match[4] || match[5] || "");
    if (!isEmail(email)) continue;
    const rawName = (match[2] || match[3] || "").trim().replace(/^"|"$/g, "");
    const name = rawName && !rawName.includes("@") ? rawName : undefined;
    results.push({ name, email });
  }
  return dedupeAddresses(results);
}

export function dedupeAddresses(addresses: Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const key = normalizeEmail(a.email);
    if (!isEmail(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^((re|fw|fwd|aw|sv|rv)\s*:\s*)+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatRelativeTime(value: string | number | Date, now = Date.now()): string {
  const date = new Date(value);
  const diff = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function safeRedirectPath(path: string | null | undefined, fallback = "/mail"): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return fallback;
  }
  return path;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
