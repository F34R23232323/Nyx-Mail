import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { readUpload } from "@nyxmail/shared/storage";
import { requireUserOrRefresh } from "@/lib/auth";
import { ApiError, json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest, context: { params: { blobId: string } }) {
  return safe(async () => {
    const auth = await requireUserOrRefresh(request);
    const attachment = await prisma.attachment.findFirst({
      where: { userId: auth.userId, blobId: context.params.blobId },
    });
    if (!attachment) throw new ApiError(404, "Attachment not found", "not_found");
    let data: Buffer;
    try {
      data = await readUpload(attachment.storagePath);
    } catch {
      throw new ApiError(404, "Attachment data is unavailable", "not_found");
    }
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(data.length),
        "Content-Disposition": contentDisposition(attachment.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  });
}

export async function HEAD() {
  return json({ error: "Use GET to download" }, { status: 405 });
}
