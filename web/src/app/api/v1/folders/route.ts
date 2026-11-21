import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { folderCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { ensureDefaultFolders } from "@/lib/folders";
import { folderToDTO } from "@/lib/serializers";
import { unreadMessageWhere } from "@/lib/unread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    await ensureDefaultFolders(auth.userId);
    const [folders, unread] = await Promise.all([
      prisma.folder.findMany({ where: { userId: auth.userId }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
      prisma.message.groupBy({
        by: ["folderId"],
        where: unreadMessageWhere(auth.userId),
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(unread.map((row) => [row.folderId, row._count._all]));
    return json({
      folders: folders.map((folder) => ({
        ...folderToDTO(folder),
        unreadCount: counts.get(folder.id) ?? 0,
      })),
    });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, folderCreateSchema);
    const folderCount = await prisma.folder.count({ where: { userId: auth.userId } });
    if (folderCount >= 100) throw new ApiError(400, "Folder limit reached", "folder_limit");
    const existing = await prisma.folder.findFirst({
      where: { userId: auth.userId, name: body.name },
      select: { id: true },
    });
    if (existing) throw new ApiError(409, "A folder with that name already exists", "folder_exists");
    const last = await prisma.folder.findFirst({
      where: { userId: auth.userId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const folder = await prisma.folder.create({
      data: {
        userId: auth.userId,
        name: body.name,
        type: "CUSTOM",
        order: (last?.order ?? 0) + 1,
      },
    });
    return json({ folder: folderToDTO(folder) }, { status: 201 });
  });
}
