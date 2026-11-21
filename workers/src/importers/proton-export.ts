import yauzl from "yauzl";
import { prisma, type ImportJob } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { resolveUploadPath } from "@nyxmail/shared/storage";
import type { ProtonExportConfig } from "@nyxmail/server";
import {
  ingestImportedMime,
  loadImportUser,
  parseCursor,
  StateMonitor,
  truncateError,
  updateJobProgress,
  type ImportUser,
} from "./common";

interface ExportCursor {
  index: number;
}

export interface ProtonExportLabel {
  id: string;
  name: string;
  path: string;
  type: number;
  color: string;
}

export interface ProtonExportRoute {
  folderType: "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "SPAM" | "TRASH" | "CUSTOM";
  folderName: string | null;
  tags: ProtonExportLabel[];
  starred: boolean;
}

const SYSTEM_NAMES: Record<string, { type: "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "SPAM" | "TRASH"; priority: number }> = {
  inbox: { type: "INBOX", priority: 0 },
  sent: { type: "SENT", priority: 1 },
  drafts: { type: "DRAFTS", priority: 2 },
  draft: { type: "DRAFTS", priority: 2 },
  spam: { type: "SPAM", priority: 3 },
  junk: { type: "SPAM", priority: 3 },
  trash: { type: "TRASH", priority: 4 },
  deleted: { type: "TRASH", priority: 4 },
  archive: { type: "ARCHIVE", priority: 5 },
};

const META_LABEL_NAMES = new Set([
  "all mail",
  "starred",
  "all drafts",
  "scheduled",
  "snoozed",
  "all sent",
  "notes",
]);

const SKIP_META_IDS = new Set(["1", "2", "5", "9", "10", "12", "15", "16"]);
const LABEL_COLORS = ["#6D4AFF", "#8B5CF6", "#0EA5E9", "#14B8A6", "#22C55E", "#F59E0B", "#EC4899"];

function labelColor(input: string | undefined, seed: string): string {
  if (input && /^#[0-9a-f]{6}$/i.test(input)) return input;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

export function parseProtonLabelsJson(value: unknown): ProtonExportLabel[] {
  if (!value || typeof value !== "object") return [];
  const payload = (value as { Payload?: unknown }).Payload;
  if (!Array.isArray(payload)) return [];
  const labels: ProtonExportLabel[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.ID ?? raw.Id ?? raw.id ?? "");
    if (!id) continue;
    const name = String(raw.Name ?? raw.name ?? raw.Path ?? "").trim();
    const path = String(raw.Path ?? raw.path ?? name).trim();
    if (!name && !path) continue;
    labels.push({
      id,
      name: name || path,
      path: path || name,
      type: Number(raw.Type ?? raw.type ?? 1) === 3 ? 3 : 1,
      color: labelColor(typeof raw.Color === "string" ? raw.Color : undefined, name || path),
    });
  }
  return labels;
}

export function parseProtonMetadata(value: unknown): {
  labelIds: string[];
  starred: boolean;
  unread: boolean | null;
} {
  if (!value || typeof value !== "object") return { labelIds: [], starred: false, unread: null };
  const payload = (value as { Payload?: unknown }).Payload;
  if (!payload || typeof payload !== "object") return { labelIds: [], starred: false, unread: null };
  const raw = payload as Record<string, unknown>;
  const labelIds = Array.isArray(raw.LabelIDs)
    ? raw.LabelIDs.filter((id): id is string => typeof id === "string")
    : [];
  const unreadValue = raw.Unread ?? raw.unread;
  const unread =
    typeof unreadValue === "boolean"
      ? unreadValue
      : typeof unreadValue === "number"
        ? unreadValue !== 0
        : unreadValue === "1" || unreadValue === "true"
          ? true
          : unreadValue === "0" || unreadValue === "false"
            ? false
            : null;
  return { labelIds, starred: false, unread };
}

export function resolveProtonExportRoute(
  labelIds: string[],
  labels: Map<string, ProtonExportLabel>,
  unread: boolean | null,
): ProtonExportRoute {
  let system:
    | { type: "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "SPAM" | "TRASH"; priority: number }
    | null = null;
  let customFolder: ProtonExportLabel | null = null;
  const tags: ProtonExportLabel[] = [];
  let starred = false;

  for (const id of labelIds) {
    const label = labels.get(id);
    if (!label) {
      if (id === "10") starred = true;
      continue;
    }
    const lowerName = label.name.toLowerCase();
    if (lowerName === "starred") {
      starred = true;
      continue;
    }
    if (META_LABEL_NAMES.has(lowerName) || SKIP_META_IDS.has(label.id)) continue;
    const systemName = SYSTEM_NAMES[lowerName];
    if (systemName) {
      if (!system || systemName.priority < system.priority) system = systemName;
      continue;
    }
    if (label.type === 3) {
      if (!customFolder) customFolder = label;
      continue;
    }
    if (!tags.some((tag) => tag.id === label.id)) tags.push(label);
  }

  if (system) {
    return {
      folderType: system.type,
      folderName: null,
      tags,
      starred,
    };
  }
  if (customFolder) {
    return {
      folderType: "CUSTOM",
      folderName: customFolder.path.slice(0, 50),
      tags,
      starred,
    };
  }
  return { folderType: "INBOX", folderName: null, tags, starred };
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (entry.uncompressedSize > maxBytes) {
      reject(new Error(`ZIP entry ${entry.fileName} is too large`));
      return;
    }
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("Could not read ZIP entry"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy(new Error("ZIP entry exceeds size limit"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

function listZipEntries(path: string): Promise<{ zip: yauzl.ZipFile; entries: yauzl.Entry[] }> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("Could not open Proton export ZIP"));
        return;
      }
      const entries: yauzl.Entry[] = [];
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!/\/$/.test(entry.fileName)) entries.push(entry);
        zip.readEntry();
      });
      zip.on("end", () => resolve({ zip, entries }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

function baseName(path: string, suffix: string): string {
  const name = path.split("/").pop() || path;
  return name.toLowerCase().endsWith(suffix)
    ? name.slice(0, name.length - suffix.length)
    : name;
}

async function getOrCreateFolder(
  user: ImportUser,
  name: string,
): Promise<{ id: string; name: string; type: string }> {
  const existing = user.folders.find(
    (folder) => folder.type === "CUSTOM" && folder.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing;
  let finalName = name.slice(0, 50);
  let counter = 2;
  while (user.folders.some((folder) => folder.name.toLowerCase() === finalName.toLowerCase())) {
    finalName = `${name.slice(0, 44)} (${counter})`;
    counter += 1;
  }
  const lastOrder = user.folders.reduce((max, folder) => Math.max(max, folder.order), 0);
  const folder = await prisma.folder.create({
    data: { userId: user.userId, name: finalName, type: "CUSTOM", order: lastOrder + 1 },
  });
  user.folders.push(folder);
  return folder;
}

async function getOrCreateLabel(
  userId: string,
  label: ProtonExportLabel,
  cache: Map<string, { id: string; name: string }>,
): Promise<{ id: string; name: string }> {
  const key = `${label.type}:${label.path}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const name = (label.type === 3 ? label.path : label.name).slice(0, 50);
  const existing = await prisma.label.findFirst({
    where: { userId, name },
    select: { id: true, name: true },
  });
  if (existing) {
    cache.set(key, existing);
    return existing;
  }
  const created = await prisma.label.create({
    data: { userId, name, color: label.color },
    select: { id: true, name: true },
  });
  cache.set(key, created);
  return created;
}

export async function runProtonExportImport(job: ImportJob): Promise<void> {
  const config = decryptJson<ProtonExportConfig>(String(job.config));
  const user = await loadImportUser(job.userId);
  const monitor = new StateMonitor(job.id);
  const cursor = parseCursor<ExportCursor>(job, { index: 0 });
  const labelCache = new Map<string, { id: string; name: string }>();
  const zipPath = resolveUploadPath(config.storagePath);
  const { zip, entries } = await listZipEntries(zipPath);

  try {
    const labelsEntries = entries.filter((entry) => /(^|\/)labels\.json$/i.test(entry.fileName));
    const labels = new Map<string, ProtonExportLabel>();
    if (labelsEntries.length === 0) {
      await updateJobProgress(job.id, {
        error: "labels.json was not found; importing messages into Inbox without Proton labels.",
      });
    }
    for (const entry of labelsEntries) {
      try {
        const parsed = parseProtonLabelsJson(JSON.parse((await readEntry(zip, entry, 5 * 1024 * 1024)).toString("utf8")));
        for (const label of parsed) labels.set(label.id, label);
      } catch {
        // A corrupt sidecar should not abort the entire mailbox.
      }
    }

    const metadataEntries = new Map<string, yauzl.Entry>();
    for (const entry of entries) {
      if (entry.fileName.toLowerCase().endsWith(".metadata.json")) {
        metadataEntries.set(baseName(entry.fileName, ".metadata.json"), entry);
      }
    }

    const emlEntries = entries
      .filter(
        (entry) =>
          entry.fileName.toLowerCase().endsWith(".eml") &&
          !entry.fileName.startsWith("__MACOSX/") &&
          !/(^|\/)\._/.test(entry.fileName),
      )
      .sort((left, right) => left.fileName.localeCompare(right.fileName));

    if (emlEntries.length === 0) {
      throw new Error("No .eml messages were found in the ZIP. Zip the mail_* export folder itself.");
    }

    await updateJobProgress(job.id, { total: emlEntries.length });
    let processed = 0;

    for (let index = Math.max(0, cursor.index); index < emlEntries.length; index += 1) {
      await monitor.check();
      const entry = emlEntries[index];
      try {
        const metadataEntry = metadataEntries.get(baseName(entry.fileName, ".eml"));
        let metadata = { labelIds: [] as string[], starred: false, unread: null as boolean | null };
        if (metadataEntry) {
          try {
            metadata = parseProtonMetadata(
              JSON.parse((await readEntry(zip, metadataEntry, 2 * 1024 * 1024)).toString("utf8")),
            );
          } catch {
            // Missing/corrupt metadata: fall back to Inbox without tags.
          }
        }
        const route = resolveProtonExportRoute(metadata.labelIds, labels, metadata.unread);
        const folder =
          route.folderType === "CUSTOM" && route.folderName
            ? await getOrCreateFolder(user, route.folderName)
            : user.folders.find((item) => item.type === route.folderType) ??
              user.folders.find((item) => item.type === "INBOX");
        if (!folder) throw new Error("Inbox folder is missing");
        const labelIds: string[] = [];
        for (const tag of route.tags) {
          const local = await getOrCreateLabel(job.userId, tag, labelCache);
          labelIds.push(local.id);
        }
        const raw = await readEntry(zip, entry, 60 * 1024 * 1024);
        const result = await ingestImportedMime({
          user,
          raw,
          folderId: folder.id,
          markRead: metadata.unread !== true,
          markStarred: route.starred,
          addLabelIds: labelIds,
          isDraft: route.folderType === "DRAFTS",
        });
        processed += 1;
        if (result.errors.length > 0) {
          await updateJobProgress(job.id, { error: result.errors[0] });
        }
      } catch (error) {
        await updateJobProgress(job.id, {
          error: `${entry.fileName}: ${truncateError(error)}`,
        });
      }
      if (index % 5 === 0 || index === emlEntries.length - 1) {
        await updateJobProgress(job.id, {
          processedDelta: processed,
          cursor: JSON.stringify({ index: index + 1 }),
        });
        processed = 0;
      }
    }
  } finally {
    zip.close();
  }
}
