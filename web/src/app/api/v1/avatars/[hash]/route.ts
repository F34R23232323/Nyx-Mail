import type { NextRequest } from "next/server";
import { requireUserOrRefresh } from "@/lib/auth";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HASH_RE = /^[a-f0-9]{32}$/;
const MAX_BYTES = 512 * 1024;
const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
const MISSING_TTL_MS = 6 * 60 * 60 * 1000;
const FAVICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
]);
const MAX_CACHE_ENTRIES = 2_000;

interface AvatarEntry {
  body: ArrayBuffer | null;
  contentType: string;
  expiresAt: number;
}

const cache = new Map<string, AvatarEntry>();
const faviconCache = new Map<string, AvatarEntry>();
const inflight = new Map<string, Promise<AvatarEntry>>();

function pruneCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const removeCount = Math.ceil(MAX_CACHE_ENTRIES / 4);
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    if (++removed >= removeCount) break;
  }
}

async function loadAvatar(hash: string): Promise<AvatarEntry> {
  const now = Date.now();
  const cached = cache.get(hash);
  if (cached && cached.expiresAt > now) return cached;

  const pending = inflight.get(hash);
  if (pending) return pending;

  const request = (async (): Promise<AvatarEntry> => {
    const url = `https://secure.gravatar.com/avatar/${hash}?s=96&d=404&r=g`;
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        "User-Agent": "NyxMail Avatar Proxy/1.0",
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    }).catch(() => null);

    if (!response) {
      return { body: null, contentType: "", expiresAt: Date.now() + 60_000 };
    }
    if (response.status === 404) {
      return { body: null, contentType: "", expiresAt: Date.now() + MISSING_TTL_MS };
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (
      !response.ok ||
      !contentType.startsWith("image/") ||
      contentType.includes("svg")
    ) {
      return { body: null, contentType: "", expiresAt: Date.now() + 60_000 };
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_BYTES) {
      return { body: null, contentType: "", expiresAt: Date.now() + MISSING_TTL_MS };
    }
    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
      return { body: null, contentType: "", expiresAt: Date.now() + MISSING_TTL_MS };
    }
    return {
      body,
      contentType,
      expiresAt: Date.now() + FOUND_TTL_MS,
    };
  })();

  inflight.set(hash, request);
  try {
    const entry = await request;
    cache.set(hash, entry);
    pruneCache();
    return entry;
  } finally {
    inflight.delete(hash);
  }
}

function emptyResponse(status: number, cacheSeconds = 0): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": cacheSeconds > 0
        ? `private, max-age=${cacheSeconds}`
        : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validDomain(value: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

async function loadFavicon(domain: string): Promise<AvatarEntry> {
  const now = Date.now();
  const cached = faviconCache.get(domain);
  if (cached && cached.expiresAt > now) return cached;
  const response = await fetch(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`, {
    headers: { "User-Agent": "NyxMail Avatar Proxy/1.0" },
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  }).catch(() => null);
  const missing: AvatarEntry = { body: null, contentType: "", expiresAt: now + MISSING_TTL_MS };
  if (!response || !response.ok) {
    faviconCache.set(domain, missing);
    return missing;
  }
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const body = await response.arrayBuffer();
  if (
    !contentType.startsWith("image/") ||
    contentType.includes("svg") ||
    body.byteLength === 0 ||
    body.byteLength > MAX_BYTES
  ) {
    faviconCache.set(domain, missing);
    return missing;
  }
  const entry = { body, contentType, expiresAt: now + FAVICON_TTL_MS };
  faviconCache.set(domain, entry);
  return entry;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { hash: string } },
) {
  let userId: string;
  try {
    const auth = await requireUserOrRefresh(request);
    userId = auth.userId;
  } catch {
    return emptyResponse(401);
  }

  const hash = params.hash.toLowerCase();
  if (!HASH_RE.test(hash)) return emptyResponse(400);

  try {
    await consumeLimit(`avatars:${userId}`, 300, 60_000);
  } catch {
    return emptyResponse(429);
  }

  let entry: AvatarEntry;
  try {
    entry = await loadAvatar(hash);
    if (!entry.body) {
      const domain = (new URL(request.url).searchParams.get("domain") || "").trim().toLowerCase();
      if (validDomain(domain) && !GENERIC_MAIL_DOMAINS.has(domain)) {
        entry = await loadFavicon(domain);
      }
    }
  } catch {
    return emptyResponse(502);
  }

  if (!entry.body) {
    return emptyResponse(404, Math.max(1, Math.floor(MISSING_TTL_MS / 1000)));
  }

  return new Response(entry.body, {
    status: 200,
    headers: {
      "Content-Type": entry.contentType,
      "Content-Length": String(entry.body.byteLength),
      "Cache-Control": "private, max-age=43200, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
