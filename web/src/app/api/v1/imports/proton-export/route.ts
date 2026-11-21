import type { NextRequest } from "next/server";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { encryptJson } from "@nyxmail/shared/secrets";
import { ensureUploadDir, resolveUploadPath } from "@nyxmail/shared/storage";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, getClientIp, json, safe } from "@/lib/http";
import { importToDTO } from "@/lib/serializers";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(
      `import-proton-export:${getClientIp(request)}:${auth.userId}`,
      8,
      24 * 60 * 60 * 1000,
      "Import limit reached",
    );
    const contentType = (request.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("zip")) {
      throw new ApiError(400, "Upload the Proton export as a .zip file", "invalid_file");
    }
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_ARCHIVE_BYTES) {
      throw new ApiError(413, "Proton export ZIPs are limited to 2GB", "too_large");
    }
    if (!request.body) throw new ApiError(400, "Missing upload body", "invalid_file");
    const active = await prisma.importJob.count({
      where: { userId: auth.userId, status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
    });
    if (active >= 3) throw new ApiError(429, "You already have three active imports", "import_active");

    const rawName = request.headers.get("x-nyxmail-filename") || "proton-export.zip";
    let originalName = "proton-export.zip";
    try {
      originalName = decodeURIComponent(rawName).replace(/[\\/\r\n\u0000]/g, "_").slice(0, 200) || originalName;
    } catch {
      originalName = rawName.replace(/[\\/\r\n\u0000]/g, "_").slice(0, 200);
    }
    if (!originalName.toLowerCase().endsWith(".zip")) originalName = `${originalName}.zip`;

    await ensureUploadDir();
    const storagePath = `imports/${auth.userId}/${randomUUID()}.zip`;
    const target = resolveUploadPath(storagePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_ARCHIVE_BYTES) {
          callback(new Error("Proton export ZIP exceeds the 2GB limit"));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
        limiter,
        createWriteStream(target, { mode: 0o600 }),
      );
    } catch (error) {
      await fs.unlink(target).catch(() => undefined);
      throw new ApiError(
        413,
        error instanceof Error ? error.message : "Could not store the upload",
        "upload_failed",
      );
    }

    const fileHandle = await fs.open(target, "r");
    try {
      const header = Buffer.alloc(4);
      await fileHandle.read(header, 0, 4, 0);
      if (header.toString("binary") !== "PK\u0003\u0004") {
        await fs.unlink(target).catch(() => undefined);
        throw new ApiError(
          400,
          "That file is not a ZIP archive. Zip the Proton mail_* export folder.",
          "invalid_zip",
        );
      }
    } finally {
      await fileHandle.close();
    }

    try {
      const job = await prisma.importJob.create({
        data: {
          userId: auth.userId,
          source: "PROTON",
          status: "PENDING",
          config: encryptJson({
            kind: "proton-export",
            storagePath,
            originalName,
          }) as unknown as Prisma.InputJsonValue,
          meta: {
            mode: "Proton export folder (ZIP)",
            filename: originalName,
            sizeBytes: received,
          } as Prisma.InputJsonValue,
        },
      });
      return json({ import: importToDTO(job) }, { status: 201 });
    } catch (error) {
      await fs.unlink(target).catch(() => undefined);
      throw error;
    }
  });
}
