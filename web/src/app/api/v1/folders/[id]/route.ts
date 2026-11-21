import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { folderUpdateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { getFolderByType, getOwnedFolder } from "@/lib/folders";
import { folderToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const folder = await getOwnedFolder(auth.userId, context.params.id);
    const body = await parseBody(request, folderUpdateSchema);
    if (body.name && folder.type !== "CUSTOM") {
      throw new ApiError(400, "System folders cannot be renamed", "system_folder");
    }
    if (body.name && body.name !== folder.name) {
      const duplicate = await prisma.folder.findFirst({
        where: { userId: auth.userId, name: body.name, id: { not: folder.id } },
        select: { id: true },
      });
      if (duplicate) throw new ApiError(409, "A folder with that name already exists", "folder_exists");
    }
    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
      },
    });
    return json({ folder: folderToDTO(updated) });
  });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const folder = await getOwnedFolder(auth.userId, context.params.id);
    if (folder.type !== "CUSTOM") throw new ApiError(400, "System folders cannot be deleted", "system_folder");
    const archive = await getFolderByType(auth.userId, "ARCHIVE");
    await prisma.$transaction([
      prisma.message.updateMany({ where: { userId: auth.userId, folderId: folder.id }, data: { folderId: archive.id } }),
      prisma.folder.delete({ where: { id: folder.id } }),
    ]);
    return json({ ok: true });
  });
}
