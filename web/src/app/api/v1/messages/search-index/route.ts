import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { json, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns ciphertext only. The browser decrypts each item and builds the
 * MiniSearch index in IndexedDB. The server has no plaintext search index.
 */
export async function GET(request: NextRequest) {
  return safe(async () => {
    const auth = await requireAuth();
    const limitParam = Number(new URL(request.url).searchParams.get("limit") || 1000);
    const limit = Math.min(Math.max(limitParam, 1), 5000);
    const messages = await prisma.message.findMany({
      where: { userId: auth.userId },
      orderBy: { sentAt: "desc" },
      take: limit,
      select: {
        id: true,
        threadId: true,
        folderId: true,
        fromAddress: true,
        fromName: true,
        toAddresses: true,
        encryptedSubject: true,
        encryptedBody: true,
        wrappedKey: true,
        sentAt: true,
        isRead: true,
        isStarred: true,
        folder: { select: { type: true } },
      },
    });
    return json(
      {
        messages: messages.map((message) => ({
          id: message.id,
          threadId: message.threadId,
          folderId: message.folderId,
          folderType: message.folder.type,
          fromAddress: message.fromAddress,
          fromName: message.fromName,
          toAddresses: Array.isArray(message.toAddresses)
            ? (message.toAddresses as Array<{ email?: string }>).map((item) => item.email || "")
            : [],
          encryptedSubject: message.encryptedSubject,
          encryptedBody: message.encryptedBody,
          wrappedKey: message.wrappedKey,
          sentAt: message.sentAt.toISOString(),
          isRead: message.isRead,
          isStarred: message.isStarred,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
