import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { prisma, jsonStringArray, type Prisma } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import type { ImportConfig } from "@nyxmail/server";
import { deleteUpload } from "@nyxmail/shared/storage";
import { performImmediateSend, type FileImportConfig, type PerformSendInput } from "@nyxmail/server";
import { sleep } from "@nyxmail/shared";
import { ImapImporter } from "./importers/providers";
import { runProtonImport } from "./importers/proton";
import { runProtonExportImport } from "./importers/proton-export";
import { runGmailImport } from "./importers/gmail";
import { syncGmailAccounts } from "./importers/gmail-sync";
import { runFileImport } from "./importers/file";
import { CancelImport, PauseImport, truncateError } from "./importers/common";
import { cleanup, recoverStuckJobs } from "./maintenance";

let stopping = false;
const pollInterval = Math.max(500, Number(process.env.WORKER_POLL_INTERVAL_MS || 3000));
const gmailSyncInterval = Math.max(30_000, Number(process.env.GMAIL_SYNC_INTERVAL_MS || 60_000));

interface ScheduledPayload {
  userId: string;
  input: PerformSendInput;
}

function log(message: string): void {
  console.log(`[nyxmail:worker ${new Date().toISOString()}] ${message}`);
}

async function appendJobError(jobId: string, error: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { errors: true } });
  const errors = jsonStringArray(job?.errors ?? []);
  errors.push(error.slice(0, 500));
  await prisma.importJob.update({
    where: { id: jobId },
    data: { errors: errors.slice(-100) as Prisma.InputJsonValue },
  });
}

async function cleanupImportSource(job: { source: string; config: unknown }): Promise<void> {
  try {
    const config = decryptJson<ImportConfig>(String(job.config));
    if (config.kind === "file" && config.storagePath) await deleteUpload(config.storagePath);
    if (config.kind === "proton-export" && config.storagePath) await deleteUpload(config.storagePath);
  } catch {
    // Missing or already-removed import files are harmless.
  }
}

async function processNextImport(): Promise<boolean> {
  const candidate = await prisma.importJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await prisma.importJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: {
      status: "RUNNING",
      startedAt: candidate.startedAt ?? new Date(),
      completedAt: null,
    },
  });
  if (claimed.count === 0) return true;
  const job = await prisma.importJob.findUnique({ where: { id: candidate.id } });
  if (!job) return true;
  log(`import ${job.id} (${job.source}) started`);
  try {
    if (job.source === "IMAP") {
      await new ImapImporter().ingest(job);
    } else if (job.source === "PROTON") {
      const protonConfig = decryptJson<ImportConfig>(String(job.config));
      if (protonConfig.kind === "proton-export") {
        await runProtonExportImport(job);
      } else {
        await runProtonImport(job);
      }
    } else if (job.source === "GMAIL") {
      await runGmailImport(job);
    } else {
      await runFileImport(job);
    }
    const fresh = await prisma.importJob.findUnique({ where: { id: job.id }, select: { status: true } });
    if (fresh?.status === "CANCELLED") {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { completedAt: new Date() },
      });
      log(`import ${job.id} cancelled`);
    } else {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date(), cursor: null },
      });
      await cleanupImportSource(job);
      log(`import ${job.id} complete`);
    }
  } catch (error) {
    if (error instanceof PauseImport) {
      await prisma.importJob.update({ where: { id: job.id }, data: { status: "PAUSED" } });
      log(`import ${job.id} paused`);
    } else if (error instanceof CancelImport) {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
      await cleanupImportSource(job);
      log(`import ${job.id} cancelled`);
    } else {
      const message = truncateError(error);
      await appendJobError(job.id, message).catch(() => undefined);
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "FAILED", completedAt: new Date() },
      });
      log(`import ${job.id} failed: ${message}`);
    }
  }
  return true;
}

async function processScheduledSend(): Promise<boolean> {
  const due = await prisma.scheduledSend.findFirst({
    where: { status: "PENDING", sendAt: { lte: new Date() } },
    orderBy: { sendAt: "asc" },
  });
  if (!due) return false;
  const claimed = await prisma.scheduledSend.updateMany({
    where: { id: due.id, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (claimed.count === 0) return true;
  log(`scheduled send ${due.id} started`);
  try {
    const payload = decryptJson<ScheduledPayload>(due.relayPayload);
    if (payload.userId !== due.userId) throw new Error("Scheduled payload owner mismatch");
    await performImmediateSend({ ...payload.input, userId: due.userId });
    await prisma.scheduledSend.update({
      where: { id: due.id },
      data: { status: "SENT", relayPayload: "", error: null },
    });
    log(`scheduled send ${due.id} sent`);
  } catch (error) {
    const message = truncateError(error);
    await prisma.scheduledSend.update({
      where: { id: due.id },
      data: { status: "FAILED", relayPayload: "", error: message },
    });
    log(`scheduled send ${due.id} failed: ${message}`);
  }
  return true;
}

async function loop(): Promise<void> {
  await recoverStuckJobs();
  let lastCleanup = 0;
  let lastGmailSync = 0;
  while (!stopping) {
    try {
      let worked = false;
      if (await processNextImport()) worked = true;
      if (await processScheduledSend()) worked = true;
      if (Date.now() - lastCleanup > 60_000) {
        lastCleanup = Date.now();
        await cleanup();
      }
      if (Date.now() - lastGmailSync >= gmailSyncInterval) {
        lastGmailSync = Date.now();
        await syncGmailAccounts().catch((error) => {
          console.error("[nyxmail:worker] gmail sync error", error);
        });
      }
      if (!worked) await sleep(pollInterval);
    } catch (error) {
      console.error("[nyxmail:worker] loop error", error);
      await sleep(Math.max(5000, pollInterval));
    }
  }
  await prisma.$disconnect();
  log("worker stopped");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is not configured");
  log("NyxMail worker online");
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}, finishing current job…`);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await loop();
}

main().catch(async (error) => {
  console.error("[nyxmail:worker] fatal", error);
  await prisma.$disconnect();
  process.exit(1);
});
