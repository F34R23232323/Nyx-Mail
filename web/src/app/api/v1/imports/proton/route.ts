import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { assertProtonBridgeHost } from "@nyxmail/server";
import { encryptJson } from "@nyxmail/shared/secrets";
import { protonImportSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { importToDTO } from "@/lib/serializers";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`import-proton:${auth.userId}`, 10, 60 * 60 * 1000, "Import limit reached");
    const body = await parseBody(request, protonImportSchema);
    const active = await prisma.importJob.count({
      where: { userId: auth.userId, status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
    });
    if (active >= 3) throw new ApiError(429, "You already have three active imports", "import_active");
    if (/[\r\n]/.test(body.host) || /[\r\n]/.test(body.username)) {
      throw new ApiError(400, "Invalid Proton Bridge settings", "invalid_import");
    }
    try {
      await assertProtonBridgeHost(body.host);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : "Proton Bridge host is not allowed",
        "private_imap_host",
      );
    }
    const job = await prisma.importJob.create({
      data: {
        userId: auth.userId,
        source: "PROTON",
        status: "PENDING",
        config: encryptJson({
          kind: "proton",
          host: body.host,
          port: body.port,
          username: body.username.trim(),
          password: body.password,
        }) as unknown as Prisma.InputJsonValue,
        meta: {
          host: body.host,
          port: body.port,
          username: body.username.trim(),
          mode: "Proton Bridge (IMAP + STARTTLS)",
        } as Prisma.InputJsonValue,
      },
    });
    return json({ import: importToDTO(job) }, { status: 201 });
  });
}
