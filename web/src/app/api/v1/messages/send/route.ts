import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { isLocalOnlySender, performImmediateSend, OutboundError } from "@nyxmail/server";
import { findLocalRecipient } from "@nyxmail/server";
import { normalizeEmail } from "@nyxmail/shared";
import { encryptJson } from "@nyxmail/shared/secrets";
import { sendSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import {
  ApiError,
  assertTrustedOrigin,
  getClientIp,
  json,
  parseBody,
  safe,
} from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapOutboundError(error: unknown): never {
  if (error instanceof OutboundError) {
    throw new ApiError(error.status, error.message, error.code);
  }
  throw error;
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await consumeLimit(`send:${auth.userId}`, 100, 60 * 60 * 1000, "Sending limit reached. Try again later.");
    const body = await parseBody(request, sendSchema);
    const sendInput = {
      fromAddress: body.fromAddress,
      gmailAccountId: body.gmailAccountId ?? null,
      to: body.to,
      cc: body.cc ?? [],
      bcc: body.bcc ?? [],
      sealed: body.sealed,
      draftId: body.draftId ?? null,
      threadId: body.threadId ?? null,
      inReplyTo: body.inReplyTo ?? null,
      references: body.references ?? [],
      relay: body.relay ?? null,
      attachments: body.attachments ?? [],
    };
    const scheduledFor = body.scheduledFor;

    if (scheduledFor) {
      const sendAt = new Date(scheduledFor);
      if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() + 30_000) {
        throw new ApiError(400, "Choose a delivery time at least 30 seconds in the future", "invalid_schedule");
      }
      if (sendAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        throw new ApiError(400, "Scheduled sends can be at most one year ahead", "invalid_schedule");
      }
      await consumeLimit(`schedule:${auth.userId}`, 200, 24 * 60 * 60 * 1000);

      const recipients = [...sendInput.to, ...sendInput.cc, ...sendInput.bcc];
      let hasExternal = false;
      for (const address of recipients) {
        const local = await findLocalRecipient(address.email);
        if (!local) {
          hasExternal = true;
        } else {
          const wrap =
            sendInput.sealed.wraps[normalizeEmail(address.email)] ||
            sendInput.sealed.wraps[normalizeEmail(local.matchedAddress)];
          if (!wrap) throw new ApiError(400, "Missing encrypted key for a local recipient", "missing_wrap");
        }
      }
      if (hasExternal && isLocalOnlySender(sendInput.fromAddress)) {
        throw new ApiError(
          400,
          `External mail cannot be sent from ${sendInput.fromAddress}. Choose one of your public addresses in the From menu.`,
          "invalid_external_sender",
        );
      }
      if (hasExternal && !sendInput.relay) {
        throw new ApiError(400, "External recipients require a relay payload", "relay_required");
      }
      const blobIds = sendInput.attachments.map((attachment) => attachment.blobId);
      if (blobIds.length) {
        const rows = await prisma.attachment.findMany({
          where: { userId: auth.userId, blobId: { in: blobIds } },
          select: { blobId: true, messageId: true },
        });
        if (rows.length !== new Set(blobIds).size) {
          throw new ApiError(400, "One or more attachments are missing", "attachment_missing");
        }
        for (const row of rows) {
          if (row.messageId && row.messageId !== sendInput.draftId) {
            throw new ApiError(400, "Attachment is already linked to another message", "attachment_linked");
          }
        }
      }
      const scheduled = await prisma.scheduledSend.create({
        data: {
          userId: auth.userId,
          sendAt,
          relayPayload: encryptJson({ userId: auth.userId, input: sendInput }),
        },
        select: { id: true, sendAt: true },
      });
      return json(
        { scheduled: true, id: scheduled.id, sendAt: scheduled.sendAt.toISOString() },
        { status: 201 },
      );
    }

    try {
      const outcome = await performImmediateSend({ userId: auth.userId, ...sendInput });
      return json(outcome);
    } catch (error) {
      mapOutboundError(error);
    }
  });
}
