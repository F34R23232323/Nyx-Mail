import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@nyxmail/db";
import { writeUpload } from "@nyxmail/shared/storage";
import { requireAuth } from "@/lib/auth";
import {
  ApiError,
  assertTrustedOrigin,
  getClientIp,
  json,
  safe,
} from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
// XChaCha20 ciphertext is base64-wrapped with a versioned nonce header.
const MAX_CIPHERTEXT_BYTES = Math.ceil(MAX_FILE_BYTES * 1.4) + 1024;

function cleanFilename(value: string): string {
  return value.replace(/[\\/\r\n\u0000]/g, "_").trim().slice(0, 200) || "attachment";
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`attachment:${getClientIp(request)}:${auth.userId}`, 300, 60 * 60 * 1000);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      throw new ApiError(400, "Expected multipart form data", "invalid_body");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "Could not read the upload", "invalid_body");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A file is required", "missing_file");
    if (file.size === 0) throw new ApiError(400, "The file is empty", "empty_file");
    if (file.size > MAX_CIPHERTEXT_BYTES) {
      throw new ApiError(413, "Attachments are limited to 25MB", "file_too_large");
    }
    const originalSize = Number(form.get("sizeBytes") || file.size);
    if (!Number.isFinite(originalSize) || originalSize <= 0 || originalSize > MAX_FILE_BYTES) {
      throw new ApiError(413, "Attachments are limited to 25MB", "file_too_large");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const storedBytes = bytes.length;
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { storageUsedBytes: true, storageLimitBytes: true },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (user.storageUsedBytes + storedBytes > user.storageLimitBytes) {
      throw new ApiError(507, "Your mailbox is full", "quota_exceeded");
    }

    const blobId = randomUUID();
    const storagePath = `${auth.userId}/${blobId}.bin`;
    await writeUpload(storagePath, bytes);
    const filename = cleanFilename(String(form.get("filename") || file.name || "attachment"));
    const mimeType = String(form.get("mimeType") || file.type || "application/octet-stream")
      .slice(0, 200);
    const contentId = form.get("contentId");
    const inline = form.get("inline") === "true";
    const attachment = await prisma.attachment.create({
      data: {
        userId: auth.userId,
        blobId,
        filename,
        mimeType,
        sizeBytes: storedBytes,
        encryptedKey: "",
        storagePath,
        contentId: typeof contentId === "string" ? contentId.slice(0, 500) : null,
        inline,
      },
    });
    await prisma.user.update({
      where: { id: auth.userId },
      data: { storageUsedBytes: { increment: storedBytes } },
    });
    return json(
      {
        attachment: {
          id: attachment.id,
          blobId,
          filename,
          mimeType,
          sizeBytes: originalSize,
          contentId: attachment.contentId,
          inline,
        },
      },
      { status: 201 },
    );
  });
}
