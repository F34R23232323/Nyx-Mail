import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@nyxmail/db";
import { learnWithRspamd } from "@nyxmail/server";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, safe } from "@/lib/http";
import { getFolderByType } from "@/lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportSchema = z.object({
  /** Reconstructed RFC822 sample from the browser, used for Bayes learning. */
  sample: z.string().max(10_000_000).optional(),
});

async function optionalSample(request: NextRequest): Promise<string | undefined> {
  const text = await request.text().catch(() => "");
  if (!text.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "Expected a JSON body", "invalid_json");
  }
  const result = reportSchema.safeParse(parsed);
  if (!result.success) throw new ApiError(400, "Invalid spam report", "validation_error");
  return result.data.sample;
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const sample = await optionalSample(request);
    const message = await prisma.message.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      select: {
        id: true,
        fromAddress: true,
        folderId: true,
        toAddresses: true,
        labels: { select: { id: true } },
      },
    });
    if (!message) throw new ApiError(404, "Message not found", "not_found");
    const spam = await getFolderByType(auth.userId, "SPAM");
    const learned = await learnWithRspamd({
      raw: sample ? Buffer.from(sample, "utf8") : Buffer.alloc(0),
      spam: true,
      from: message.fromAddress,
      rcpt: [auth.email],
      user: auth.userId,
    }).catch((error: unknown) => ({
      learned: false,
      error: error instanceof Error ? error.message : "rspamd learning failed",
    }));
    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: { folderId: spam.id, isRead: true, trashedAt: null, purgeAt: null },
      }),
      prisma.mailFilter.upsert({
        where: {
          userId_kind_pattern: {
            userId: auth.userId,
            kind: "BLOCK",
            pattern: message.fromAddress.toLowerCase(),
          },
        },
        create: {
          userId: auth.userId,
          kind: "BLOCK",
          pattern: message.fromAddress.toLowerCase(),
        },
        update: {},
      }),
      prisma.senderStat.upsert({
        where: { userId_address: { userId: auth.userId, address: message.fromAddress.toLowerCase() } },
        create: {
          userId: auth.userId,
          address: message.fromAddress.toLowerCase(),
          spamReports: 1,
        },
        update: { spamReports: { increment: 1 } },
      }),
    ]);
    return json({
      ok: true,
      blockedSender: message.fromAddress,
      learned: learned.learned,
      learning: learned,
    });
  });
}
