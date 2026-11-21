import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { encryptJson } from "@nyxmail/shared/secrets";
import { assertPublicHost } from "@nyxmail/server";
import { importImapSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { importToDTO } from "@/lib/serializers";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const jobs = await prisma.importJob.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return json({ imports: jobs.map(importToDTO) });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`import:${auth.userId}`, 10, 60 * 60 * 1000, "Import limit reached");
    const body = await parseBody(request, importImapSchema);
    const active = await prisma.importJob.count({
      where: {
        userId: auth.userId,
        status: { in: ["PENDING", "RUNNING", "PAUSED"] },
      },
    });
    if (active >= 3) throw new ApiError(429, "You already have three active imports", "import_active");
    if (/[\r\n]/.test(body.host) || /[\r\n]/.test(body.username)) {
      throw new ApiError(400, "Invalid IMAP settings", "invalid_import");
    }
    try {
      await assertPublicHost(body.host);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : "IMAP host is not allowed",
        "private_imap_host",
      );
    }
    const job = await prisma.importJob.create({
      data: {
        userId: auth.userId,
        source: "IMAP",
        status: "PENDING",
        config: encryptJson({
          kind: "imap",
          host: body.host,
          port: body.port,
          secure: body.secure,
          username: body.username,
          password: body.password,
        }) as unknown as Prisma.InputJsonValue,
        meta: {
          host: body.host,
          port: body.port,
          secure: body.secure,
          username: body.username,
        } as Prisma.InputJsonValue,
      },
    });
    return json({ import: importToDTO(job) }, { status: 201 });
  });
}
