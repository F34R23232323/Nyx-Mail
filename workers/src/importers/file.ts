import type { ImportJob } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { readUpload } from "@nyxmail/shared/storage";
import { splitMbox } from "@nyxmail/server";
import type { FileImportConfig } from "@nyxmail/server";
import {
  ingestImportedMime,
  loadImportUser,
  parseCursor,
  StateMonitor,
  truncateError,
  updateJobProgress,
} from "./common";

interface FileCursor {
  index: number;
}

export async function runFileImport(job: ImportJob): Promise<void> {
  const config = decryptJson<FileImportConfig>(String(job.config));
  const user = await loadImportUser(job.userId);
  const monitor = new StateMonitor(job.id);
  let raw: Buffer;
  try {
    raw = await readUpload(config.storagePath);
  } catch {
    throw new Error("The uploaded import file is no longer available");
  }
  const chunks = config.format === "eml" ? [raw] : splitMbox(raw);
  const cursor = parseCursor<FileCursor>(job, { index: 0 });
  const inbox = user.folders.find((folder) => folder.type === "INBOX");
  if (!inbox) throw new Error("Inbox folder is missing");
  await updateJobProgress(job.id, { total: chunks.length });

  let processed = 0;
  for (let index = cursor.index; index < chunks.length; index += 1) {
    await monitor.check();
    try {
      const result = await ingestImportedMime({
        user,
        raw: chunks[index],
        folderId: inbox.id,
        markRead: true,
      });
      processed += 1;
      if (result.errors.length > 0) {
        await updateJobProgress(job.id, {
          error: `${config.format.toUpperCase()} message ${index + 1}: ${result.errors[0]}`,
        });
      }
    } catch (error) {
      await updateJobProgress(job.id, {
        error: `${config.format.toUpperCase()} message ${index + 1}: ${truncateError(error)}`,
      });
    }
    if (index % 10 === 0 || index === chunks.length - 1) {
      await updateJobProgress(job.id, {
        processedDelta: processed,
        cursor: JSON.stringify({ index: index + 1 }),
      });
      processed = 0;
    }
  }
}
