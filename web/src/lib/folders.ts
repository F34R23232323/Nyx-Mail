import { prisma, type FolderType } from "@nyxmail/db";
import { ApiError } from "./http";

export const SYSTEM_FOLDERS: Array<{ name: string; type: Exclude<FolderType, "CUSTOM">; order: number }> = [
  { name: "Inbox", type: "INBOX", order: 0 },
  { name: "Sent", type: "SENT", order: 1 },
  { name: "Drafts", type: "DRAFTS", order: 2 },
  { name: "Archive", type: "ARCHIVE", order: 3 },
  { name: "Spam", type: "SPAM", order: 4 },
  { name: "Trash", type: "TRASH", order: 5 },
];

export const FOLDER_LABELS: Record<FolderType, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFTS: "Drafts",
  ARCHIVE: "Archive",
  SPAM: "Spam",
  TRASH: "Trash",
  CUSTOM: "Folder",
};

const FOLDER_TYPES = new Set<FolderType>(
  Object.keys(FOLDER_LABELS) as FolderType[],
);

/**
 * Folder selectors come from two places: system names such as `INBOX` and
 * database ids from the sidebar. Only treat a value as an enum when it is a
 * real folder type; Prisma rejects arbitrary ids in an enum field.
 */
export function isFolderType(value: string): value is FolderType {
  return FOLDER_TYPES.has(value as FolderType);
}

export async function ensureDefaultFolders(userId: string): Promise<void> {
  for (const folder of SYSTEM_FOLDERS) {
    const existing = await prisma.folder.findFirst({
      where: { userId, type: folder.type },
      select: { id: true },
    });
    if (existing) continue;
    try {
      await prisma.folder.create({ data: { userId, ...folder } });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
}

export async function getFolderByType(
  userId: string,
  type: FolderType,
): Promise<{ id: string; name: string; type: FolderType }> {
  const folder = await prisma.folder.findFirst({
    where: { userId, type },
    select: { id: true, name: true, type: true },
  });
  if (!folder) {
    await ensureDefaultFolders(userId);
    const retry = await prisma.folder.findFirst({
      where: { userId, type },
      select: { id: true, name: true, type: true },
    });
    if (!retry) throw new ApiError(500, "Mailbox folder could not be created");
    return retry;
  }
  return folder;
}

export async function getOwnedFolder(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
  if (!folder) throw new ApiError(404, "Folder not found", "not_found");
  return folder;
}

export function folderNameForType(type: FolderType): string {
  return SYSTEM_FOLDERS.find((folder) => folder.type === type)?.name ?? "Folder";
}
