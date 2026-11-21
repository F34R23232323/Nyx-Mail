import type { NextRequest } from "next/server";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { requireUserOrRefresh } from "@/lib/auth";
import { ApiError, json, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4) return true;
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("::ffff:127.") ||
      lower.startsWith("::ffff:10.") ||
      lower.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function validateUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ApiError(400, "Only http and https images are proxied", "bad_url");
  }
  if (url.username || url.password) throw new ApiError(400, "Invalid image URL", "bad_url");
  if (url.port && !["80", "443", ""].includes(url.port)) {
    throw new ApiError(400, "Invalid image port", "bad_url");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) {
    throw new ApiError(400, "Private image hosts are not allowed", "private_host");
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new ApiError(400, "Private image hosts are not allowed", "private_host");
  }
}

async function fetchImage(url: URL, redirects = 0): Promise<Response> {
  if (redirects > 3) throw new ApiError(400, "Too many redirects", "too_many_redirects");
  await validateUrl(url);
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      "User-Agent": "NyxMail Image Proxy/1.0",
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  }).catch(() => {
    throw new ApiError(502, "Image could not be loaded", "fetch_failed");
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new ApiError(502, "Invalid redirect", "fetch_failed");
    return fetchImage(new URL(location, url), redirects + 1);
  }
  if (!response.ok) throw new ApiError(502, "Image host returned an error", "fetch_failed");
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/") || type.includes("svg")) {
    throw new ApiError(400, "Remote content is not a supported image", "invalid_type");
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new ApiError(413, "Image is too large", "too_large");
  return response;
}

export async function GET(request: NextRequest) {
  return safe(async () => {
    const auth = await requireUserOrRefresh(request);
    await consumeLimit(`image-proxy:${auth.userId}`, 120, 60 * 1000);
    const raw = new URL(request.url).searchParams.get("url");
    if (!raw) throw new ApiError(400, "Missing image URL", "missing_url");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ApiError(400, "Invalid image URL", "bad_url");
    }
    const response = await fetchImage(url);
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(502, "Empty image response", "fetch_failed");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "Image is too large", "too_large");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Content-Length": String(total),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}

export async function POST() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
