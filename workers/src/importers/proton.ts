import { ImapFlow } from "imapflow";
import { prisma, type ImportJob } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { assertProtonBridgeHost, type ProtonImportConfig } from "@nyxmail/server";
import {
  ingestImportedMime,
  loadImportUser,
  parseCursor,
  resolveImportFolder,
  StateMonitor,
  truncateError,
  updateJobProgress,
  type ImportUser,
} from "./common";

interface ProtonCursor {
  mailboxIndex: number;
  start: number;
}

interface ProtonLabel {
  id: string;
  name: string;
}

const LABEL_COLORS = ["#6D4AFF", "#8B5CF6", "#0EA5E9", "#14B8A6", "#22C55E", "#F59E0B", "#EC4899"];

async function getOrCreateLabel(userId: string, name: string, cache: Map<string, ProtonLabel>): Promise<ProtonLabel> {
  const cached = cache.get(name);
  if (cached) return cached;
  const existing = await prisma.label.findFirst({
    where: { userId, name },
    select: { id: true, name: true },
  });
  if (existing) {
    cache.set(name, existing);
    return existing;
  }
  let color = LABEL_COLORS[0];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  color = LABEL_COLORS[hash % LABEL_COLORS.length];
  const created = await prisma.label.create({
    data: { userId, name, color },
    select: { id: true, name: true },
  });
  cache.set(name, created);
  return created;
}

export function protonLabelName(path: string): string | null {
  const match = /^Labels[./](.+)$/i.exec(path);
  if (!match) return null;
  return match[1]
    .split(/[./]/)
    .filter(Boolean)
    .join(" / ")
    .slice(0, 50);
}

export function protonFolderName(path: string): string | null {
  const match = /^Folders[./](.+)$/i.exec(path);
  if (!match) return null;
  return match[1]
    .split(/[./]/)
    .filter(Boolean)
    .join(" / ")
    .slice(0, 50);
}

async function getOrCreateProtonFolder(user: ImportUser, name: string): Promise<{ id: string; name: string; type: string }> {
  const existing = user.folders.find(
    (folder) => folder.type === "CUSTOM" && folder.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing;
  let finalName = name;
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

export function isIgnoredMailbox(path: string, specialUse?: string): boolean {
  const normalized = path.trim().toLowerCase();
  const special = (specialUse || "").toLowerCase();
  return (
    special === "\\all" ||
    special === "\\flagged" ||
    normalized === "all mail" ||
    normalized === "starred" ||
    normalized === "all" ||
    normalized === "flagged" ||
    normalized === "labels"
  );
}

export async function runProtonImport(job: ImportJob): Promise<void> {
  const config = decryptJson<ProtonImportConfig>(String(job.config));
  await assertProtonBridgeHost(config.host);
  const user: ImportUser = await loadImportUser(job.userId);
  const monitor = new StateMonitor(job.id);
  const batchSize = Math.max(1, Math.min(100, Number(process.env.IMPORT_BATCH_SIZE || 25)));
  const cursor = parseCursor<ProtonCursor>(job, { mailboxIndex: 0, start: 1 });
  const labelCache = new Map<string, ProtonLabel>();

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: false,
    doSTARTTLS: true,
    auth: { user: config.username, pass: config.password },
    logger: false,
    socketTimeout: 120_000,
    // Proton Bridge uses a locally generated self-signed certificate. This
    // importer is intended for loopback/private Bridge connections only.
    tls: { rejectUnauthorized: false, servername: config.host },
  });

  await client.connect();
  try {
    const allMailboxes = (await client.list()).filter(
      (mailbox) => !mailbox.flags?.has("\\Noselect") && mailbox.listed,
    );
    const mailboxes = allMailboxes
      .filter((mailbox) => !isIgnoredMailbox(mailbox.path, mailbox.specialUse))
      .sort((left, right) => {
        const leftLabel = protonLabelName(left.path) ? 1 : 0;
        const rightLabel = protonLabelName(right.path) ? 1 : 0;
        return leftLabel - rightLabel;
      });

    let total = 0;
    for (const mailbox of mailboxes) {
      try {
        const status = await client.status(mailbox.path, { messages: true });
        total += status.messages ?? 0;
      } catch {
        // approximate total if STATUS is unavailable
      }
    }
    await updateJobProgress(job.id, { total });

    for (let index = cursor.mailboxIndex; index < mailboxes.length; index += 1) {
      await monitor.check(true);
      const mailbox = mailboxes[index];
      const labelName = protonLabelName(mailbox.path);
      const label = labelName ? await getOrCreateLabel(job.userId, labelName, labelCache) : null;
      const protonFolder = protonFolderName(mailbox.path);
      const folder = label
        ? user.folders.find((item) => item.type === "INBOX") ??
          (await resolveImportFolder(user, "Inbox", "\\Inbox"))
        : protonFolder
          ? await getOrCreateProtonFolder(user, protonFolder)
          : await resolveImportFolder(user, mailbox.name || mailbox.path, mailbox.specialUse);
      const mappingName = label ? `Label: ${label.name}` : folder.name;

      await updateJobProgress(job.id, {
        folderMapping: { [mailbox.path]: mappingName },
        cursor: JSON.stringify({
          mailboxIndex: index,
          start: index === cursor.mailboxIndex ? cursor.start : 1,
        }),
      });

      const lock = await client.getMailboxLock(mailbox.path);
      try {
        const exists =
          client.mailbox && typeof client.mailbox === "object" && "exists" in client.mailbox
            ? Number(client.mailbox.exists)
            : 0;
        let start = index === cursor.mailboxIndex ? Math.max(1, cursor.start) : 1;
        while (start <= exists) {
          await monitor.check(true);
          const end = Math.min(exists, start + batchSize - 1);
          let processed = 0;
          for await (const message of client.fetch(`${start}:${end}`, {
            source: true,
            flags: true,
            internalDate: true,
          })) {
            if (!message.source) continue;
            await monitor.check();
            try {
              const result = await ingestImportedMime({
                user,
                raw: message.source,
                folderId: folder.id,
                markRead: Boolean(message.flags?.has("\\Seen")),
                markStarred: Boolean(message.flags?.has("\\Flagged")),
                addLabelIds: label ? [label.id] : [],
              });
              processed += 1;
              if (result.errors.length > 0) {
                await updateJobProgress(job.id, { error: result.errors[0] });
              }
            } catch (error) {
              await updateJobProgress(job.id, {
                error: `Proton ${mailbox.path}: ${truncateError(error)}`,
              });
            }
          }
          start = end + 1;
          await updateJobProgress(job.id, {
            processedDelta: processed,
            cursor: JSON.stringify({ mailboxIndex: index, start }),
          });
        }
      } finally {
        lock.release();
      }
      await updateJobProgress(job.id, {
        cursor: JSON.stringify({ mailboxIndex: index + 1, start: 1 }),
      });
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
