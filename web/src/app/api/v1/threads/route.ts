import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@nyxmail/db";
import { requireAuth } from "@/lib/auth";
import { isFolderType } from "@/lib/folders";
import { json, safe } from "@/lib/http";
import { threadToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return safe(async () => {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);
    const folderParam = searchParams.get("folder") || "INBOX";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") || 30)));
    const q = searchParams.get("q")?.trim().slice(0, 120) || "";
    const labelId = searchParams.get("label") || undefined;
    const unreadOnly = searchParams.get("unread") === "1";
    const now = new Date();

    const isAll = folderParam === "ALL";
    const isStarred = folderParam === "STARRED";
    const folder =
      isAll || isStarred
        ? null
        : await prisma.folder.findFirst({
            where: {
              userId: auth.userId,
              ...(isFolderType(folderParam)
                ? { type: folderParam }
                : { id: folderParam }),
            },
          });
    if (!isAll && !isStarred && !folder) {
      return json({ items: [], nextPage: null });
    }

    const and: Prisma.MessageWhereInput[] = [
      { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }] },
    ];
    if (q) {
      and.push({
        OR: [
          { fromAddress: { contains: q, mode: "insensitive" } },
          { fromName: { contains: q, mode: "insensitive" } },
        ],
      });
    }
    if (labelId) {
      and.push({ labels: { some: { id: labelId, userId: auth.userId } } });
    }
    if (unreadOnly) {
      and.push({ isRead: false, isDraft: false });
    }
    const baseMessageWhere: Prisma.MessageWhereInput = {
      userId: auth.userId,
      ...(isStarred ? { isStarred: true } : {}),
      ...(folder ? { folderId: folder.id } : {}),
      ...(isAll ? { folder: { type: { not: "TRASH" } } } : {}),
      AND: and,
    };

    const threads = await prisma.thread.findMany({
      where: {
        userId: auth.userId,
        messages: { some: baseMessageWhere },
      },
      orderBy: { lastActivityAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      include: {
        messages: {
          where: baseMessageWhere,
          orderBy: { sentAt: "desc" },
          take: 30,
          include: { folder: true, labels: true, attachmentRows: true },
        },
      },
    });

    const hasNext = threads.length > pageSize;
    const pageThreads = hasNext ? threads.slice(0, pageSize) : threads;
    const unreadRows = pageThreads.length
      ? await prisma.message.groupBy({
          by: ["threadId"],
          where: {
            ...baseMessageWhere,
            threadId: { in: pageThreads.map((thread) => thread.id) },
            isRead: false,
          },
          _count: { _all: true },
        })
      : [];
    const unreadMap = new Map(unreadRows.map((row) => [row.threadId, row._count._all]));

    return json({
      items: pageThreads
        .filter((thread) => thread.messages.length > 0)
        .map((thread) =>
          threadToDTO({ ...thread, unreadCount: unreadMap.get(thread.id) ?? 0 }),
        ),
      nextPage: hasNext ? page + 1 : null,
    });
  });
}
