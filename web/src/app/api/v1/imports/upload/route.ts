import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { randomUUID } from "node:crypto";
import { prisma } from "@nyxmail/db";
import { encryptJson } from "@nyxmail/shared/secrets";
import { deleteUpload, writeUpload } from "@nyxmail/shared/storage";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, safe } from "@/lib/http";
import { importToDTO } from "@/lib/serializers";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`import-file:${auth.userId}`, 20, 24 * 60 * 60 * 1000, "Import limit reached");
    const active = await prisma.importJob.count({
      where: { userId: auth.userId, status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
    });
    if (active >= 3) throw new ApiError(429, "You already have three active imports", "import_active");
    const type = request.headers.get("content-type") || "";
    if (!type.includes("multipart/form-data")) {
      throw new ApiError(400, "Expected a file upload", "invalid_body");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "Could not read upload", "invalid_body");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A file is required", "missing_file");
    if (file.size === 0) throw new ApiError(400, "The file is empty", "empty_file");
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ApiError(413, "Import files are limited to 250MB", "too_large");
    }
    const lower = file.name.toLowerCase();
    const requested = String(form.get("source") || "").toUpperCase();
    const format = requested === "EML" || lower.endsWith(".eml") ? "eml" : "mbox";
    if (format === "mbox" && !lower.endsWith(".mbox") && !lower.endsWith(".mbx") && requested !== "MBOX") {
      throw new ApiError(400, "Upload an .mbox, .mbx or .eml file", "invalid_file");
    }
    const id = randomUUID();
    const storagePath = `imports/${auth.userId}/${id}.${format}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeUpload(storagePath, bytes);
    try {
      const job = await prisma.importJob.create({
        data: {
          userId: auth.userId,
          source: format === "eml" ? "EML" : "MBOX",
          status: "PENDING",
          config: encryptJson({
            kind: "file",
            format,
            storagePath,
            originalName: file.name.slice(0, 200),
          }) as unknown as Prisma.InputJsonValue,
          meta: {
            filename: file.name.slice(0, 200),
            sizeBytes: file.size,
          } as Prisma.InputJsonValue,
        },
      });
      return json({ import: importToDTO(job) }, { status: 201 });
    } catch (error) {
      await deleteUpload(storagePath);
      throw error;
    }
  });
}
