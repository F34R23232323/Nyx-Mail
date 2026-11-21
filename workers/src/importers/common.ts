import { prisma, type ImportJob, type Prisma } from "@nyxmail/db";
import { ingestRawMessage } from "@nyxmail/server";
import { jsonStringArray } from "@nyxmail/db";

export class PauseImport extends Error {
  constructor() {
    super("Import paused");
    this.name = "PauseImport";
  }
}

export class CancelImport extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "CancelImport";
  }
}

export interface ImportUser {
  userId: string;
  email: string;
  folders: Array<{ id: string; name: string; type: string; order: number }>;
}

const SYSTEM_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFTS: "Drafts",
  ARCHIVE: "Archive",
  SPAM: "Spam",
  TRASH: "Trash",
};

export async function loadImportUser(userId: string): Promise<ImportUser> {
  let folders = await prisma.folder.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  });
  const types = new Set(folders.map((folder) => folder.type));
  for (const [type, name] of Object.entries(SYSTEM_NAMES)) {
    if (!types.has(type as never)) {
      try {
        const folder = await prisma.folder.create({
          data: { userId, name, type: type as never, order: Object.keys(SYSTEM_NAMES).indexOf(type) },
        });
        folders.push(folder);
      } catch {
        // already created concurrently
      }
    }
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new Error("Import user no longer exists");
  folders = await prisma.folder.findMany({ where: { userId }, orderBy: { order: "asc" } });
  return { userId, email: user.email, folders };
}

function systemTypeFor(mailboxName: string, specialUse?: string): string | null {
  const special = (specialUse || "").toLowerCase();
  const name = mailboxName.toLowerCase();
  if (special.includes("sent") || name === "sent" || name === "sent mail" || name === "sent items") return "SENT";
  if (special.includes("draft") || name === "drafts") return "DRAFTS";
  if (special.includes("archive")) return "ARCHIVE";
  if (special.includes("junk") || special.includes("spam")) return "SPAM";
  if (special.includes("trash") || special.includes("deleted")) return "TRASH";
  if (special.includes("inbox") || name === "inbox") return "INBOX";
  return null;
}

function customName(mailboxName: string): string {
  const segment = mailboxName.split(/[\\/.]/).filter(Boolean).pop() || "Imported";
  return segment.trim().slice(0, 50) || "Imported";
}

export async function resolveImportFolder(
  user: ImportUser,
  mailboxName: string,
  specialUse?: string,
): Promise<{ id: string; name: string; type: string }> {
  const system = systemTypeFor(mailboxName, specialUse);
  if (system) {
    const folder = user.folders.find((item) => item.type === system);
    if (folder) return folder;
  }
  const base = customName(mailboxName);
  const candidates = [base, `Imported ${base}`, `${base} (imported)`];
  for (const candidate of candidates) {
    const existing = user.folders.find(
      (folder) => folder.type === "CUSTOM" && folder.name.toLowerCase() === candidate.toLowerCase(),
    );
    if (existing) return existing;
  }
  let name = base;
  let counter = 2;
  while (user.folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
    name = `${base} (${counter})`;
    counter += 1;
  }
  const lastOrder = user.folders.reduce((max, folder) => Math.max(max, folder.order), 0);
  const folder = await prisma.folder.create({
    data: { userId: user.userId, name, type: "CUSTOM", order: lastOrder + 1 },
  });
  user.folders.push(folder);
  return folder;
}

export interface JobProgress {
  processedDelta?: number;
  total?: number;
  cursor?: string | null;
  folderMapping?: Record<string, string>;
  error?: string;
}

export function parseCursor<T>(job: Pick<ImportJob, "cursor">, fallback: T): T {
  if (!job.cursor) return fallback;
  try {
    return JSON.parse(job.cursor) as T;
  } catch {
    return fallback;
  }
}

export async function updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { errors: true, folderMapping: true },
  });
  if (!job) throw new CancelImport();
  const errors = jsonStringArray(job.errors);
  if (progress.error) {
    errors.push(progress.error.slice(0, 500));
  }
  const update: Prisma.ImportJobUpdateInput = {};
  if (progress.processedDelta) update.progressMessages = { increment: progress.processedDelta };
  if (progress.total !== undefined) update.totalMessages = progress.total;
  if (progress.cursor !== undefined) update.cursor = progress.cursor;
  if (progress.folderMapping) {
    update.folderMapping = {
      ...(job.folderMapping && typeof job.folderMapping === "object" && !Array.isArray(job.folderMapping)
        ? (job.folderMapping as Record<string, string>)
        : {}),
      ...progress.folderMapping,
    } as Prisma.InputJsonValue;
  }
  if (progress.error || errors.length !== jsonStringArray(job.errors).length) {
    update.errors = errors.slice(-100) as Prisma.InputJsonValue;
  }
  await prisma.importJob.update({ where: { id: jobId }, data: update });
}

export class StateMonitor {
  private checks = 0;

  constructor(
    private readonly jobId: string,
    private readonly every = 8,
  ) {}

  async check(force = false): Promise<void> {
    this.checks += 1;
    if (!force && this.checks % this.every !== 0) return;
    const job = await prisma.importJob.findUnique({
      where: { id: this.jobId },
      select: { status: true },
    });
    if (!job) throw new CancelImport();
    if (job.status === "PAUSED") throw new PauseImport();
    if (job.status === "CANCELLED") throw new CancelImport();
  }
}

export async function ingestImportedMime(input: {
  user: ImportUser;
  raw: Buffer;
  folderId: string;
  markRead: boolean;
  markStarred?: boolean;
  addLabelIds?: string[];
  isDraft?: boolean;
}): Promise<{ delivered: number; skipped: string[]; errors: string[] }> {
  const result = await ingestRawMessage({
    envelopeTo: [input.user.email],
    raw: input.raw,
    targetFolderId: input.folderId,
    markRead: input.markRead,
    markStarred: input.markStarred,
    addLabelIds: input.addLabelIds,
    isDraft: input.isDraft,
  });
  return {
    delivered: result.delivered.length,
    skipped: result.skipped.map((item) => item.reason),
    errors: result.errors,
  };
}

export function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 400);
}
