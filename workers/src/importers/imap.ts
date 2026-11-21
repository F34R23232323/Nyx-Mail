import { ImapFlow } from "imapflow";
import type { ImportJob } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { assertPublicHost } from "@nyxmail/server";
import type { ImapImportConfig } from "@nyxmail/server";
import {
  ingestImportedMime,
  loadImportUser,
  parseCursor,
  resolveImportFolder,
  StateMonitor,
  truncateError,
  updateJobProgress,
} from "./common";

interface ImapCursor {
  mailboxIndex: number;
  start: number;
}

export async function runImapImport(job: ImportJob): Promise<void> {
  const config = decryptJson<ImapImportConfig>(String(job.config));
  await assertPublicHost(config.host);
  const user = await loadImportUser(job.userId);
  const monitor = new StateMonitor(job.id);
  const batchSize = Math.max(1, Math.min(100, Number(process.env.IMPORT_BATCH_SIZE || 25)));
  const cursor = parseCursor<ImapCursor>(job, { mailboxIndex: 0, start: 1 });

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
    tls: { rejectUnauthorized: true },
    socketTimeout: 120_000,
  });

  await client.connect();
  try {
    const mailboxes = (await client.list()).filter(
      (mailbox) => !mailbox.flags?.has("\\Noselect") && mailbox.listed,
    );
    let total = 0;
    for (const mailbox of mailboxes) {
      try {
        const status = await client.status(mailbox.path, { messages: true });
        total += status.messages ?? 0;
      } catch {
        // Some servers forbid STATUS on certain mailboxes; progress will be approximate.
      }
    }
    await updateJobProgress(job.id, { total });

    for (let index = cursor.mailboxIndex; index < mailboxes.length; index += 1) {
      await monitor.check(true);
      const mailbox = mailboxes[index];
      const folder = await resolveImportFolder(user, mailbox.name || mailbox.path, mailbox.specialUse);
      await updateJobProgress(job.id, {
        folderMapping: { [mailbox.path]: folder.name },
        cursor: JSON.stringify({ mailboxIndex: index, start: index === cursor.mailboxIndex ? cursor.start : 1 }),
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
          let inboxErrors = 0;
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
              });
              processed += 1;
              if (result.errors.length > 0) {
                inboxErrors += result.errors.length;
                await updateJobProgress(job.id, { error: result.errors[0] });
              }
            } catch (error) {
              inboxErrors += 1;
              await updateJobProgress(job.id, { error: `IMAP ${mailbox.path}: ${truncateError(error)}` });
            }
          }
          start = end + 1;
          await updateJobProgress(job.id, {
            processedDelta: processed,
            cursor: JSON.stringify({ mailboxIndex: index, start }),
          });
          if (inboxErrors > 0) {
            // Keeps the loop responsive without flooding the log.
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
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
