import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  labelId: z.string().cuid(),
  add: z.boolean(),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, schema);
    const [thread, label] = await Promise.all([
      prisma.thread.findFirst({
        where: { id: context.params.id, userId: auth.userId },
        select: { id: true },
      }),
      prisma.label.findFirst({
        where: { id: body.labelId, userId: auth.userId },
        select: { id: true },
      }),
    ]);
    if (!thread) throw new ApiError(404, "Conversation not found", "not_found");
    if (!label) throw new ApiError(404, "Label not found", "not_found");
    const messages = await prisma.message.findMany({
      where: { userId: auth.userId, threadId: thread.id },
      select: { id: true },
    });
    await prisma.$transaction(
      messages.map((message) =>
        prisma.message.update({
          where: { id: message.id },
          data: {
            labels: body.add
              ? { connect: { id: label.id } }
              : { disconnect: { id: label.id } },
          },
        }),
      ),
    );
    return json({ ok: true, updated: messages.length });
  });
}
