import type { NextRequest } from "next/server";
import { z } from "zod";
import { ingestRawMessage } from "@nyxmail/server";
import { safeEqual } from "@nyxmail/shared/secrets";
import { ApiError, getClientIp, json, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  envelopeFrom: z.string().max(500).optional(),
  envelopeTo: z.array(z.string().max(500)).min(1).max(100),
  rawMimeBase64: z.string().min(20).max(90_000_000),
  authResults: z
    .object({
      spf: z.enum(["pass", "fail", "softfail", "neutral", "none"]).optional(),
      dkim: z.enum(["pass", "fail", "none"]).optional(),
      dmarc: z.enum(["pass", "fail", "none"]).optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  return safe(async () => {
    const ip = getClientIp(request);
    await consumeLimit(`ingest:${ip}`, 3000, 60 * 1000, "Ingest rate limit exceeded");
    const timestamp = request.headers.get("x-nyxmail-timestamp") || "";
    const signature = request.headers.get("x-nyxmail-signature") || "";
    if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new ApiError(401, "Missing ingest signature", "invalid_signature");
    }
    const timestampMs = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000;
    if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      throw new ApiError(401, "Ingest timestamp expired", "stale_signature");
    }
    const secret = process.env.INGEST_SECRET;
    if (!secret) throw new ApiError(500, "Ingest is not configured");
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 90_000_000) throw new ApiError(413, "Payload too large", "too_large");
    const rawBody = await request.text();
    const hmac = await import("node:crypto").then(({ createHmac }) =>
      createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"),
    );
    if (!safeEqual(hmac, signature.toLowerCase())) {
      throw new ApiError(401, "Invalid ingest signature", "invalid_signature");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new ApiError(400, "Invalid JSON", "invalid_json");
    }
    const body = schema.parse(payload);
    let raw: Buffer;
    try {
      raw = Buffer.from(body.rawMimeBase64, "base64");
    } catch {
      throw new ApiError(400, "Invalid MIME payload", "invalid_mime");
    }
    if (raw.length === 0) throw new ApiError(400, "Empty MIME payload", "invalid_mime");
    if (raw.length > 60 * 1024 * 1024) throw new ApiError(413, "Message too large", "too_large");

    const result = await ingestRawMessage({
      envelopeFrom: body.envelopeFrom,
      envelopeTo: body.envelopeTo,
      raw,
      authResults: body.authResults,
    });
    return json({
      ok: result.errors.length === 0,
      delivered: result.delivered.map((delivery) => ({
        threadId: delivery.threadId,
        spam: delivery.spam.spam,
      })),
      duplicates: result.duplicates,
      skipped: result.skipped,
      errors: result.errors,
    });
  });
}
