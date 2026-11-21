import { prisma } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { sleep } from "@nyxmail/shared";
import { accessToken, chooseFolder, gmailFetch } from "./gmail";
import { ingestImportedMime, loadImportUser, truncateError } from "./common";

interface GmailAccountCredentials {
  refreshToken: string;
}

interface GmailMessage {
  id: string;
  raw?: string;
  labelIds?: string[];
}

interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
}

// Gmail can take a while to make a newly delivered message visible through
// messages.list. A wide overlap window prevents the sync cursor from moving
// past a message that was not indexed yet. Duplicate imports are already
// suppressed by Message-ID, so re-scanning is safe.
const OVERLAP_SECONDS = Math.max(120, Number(process.env.GMAIL_SYNC_OVERLAP_SECONDS || 600));

/**
 * Poll connected Gmail accounts for messages newer than the last successful
 * sync. The initial OAuth import handles the full mailbox backfill; this loop
 * keeps NyxMail up to date with new Gmail mail afterwards.
 */
export async function syncGmailAccounts(): Promise<void> {
  const accounts = await prisma.gmailAccount.findMany({
    where: { enabled: true },
    orderBy: [{ lastSyncAt: "asc" }, { createdAt: "asc" }],
    take: 20,
  });
  if (accounts.length === 0) return;

  for (const account of accounts) {
    try {
      const credentials = decryptJson<GmailAccountCredentials>(account.credentials);
      const token = await accessToken({ refreshToken: credentials.refreshToken });
      const user = await loadImportUser(account.userId);
      const since = Math.max(
        0,
        Math.floor((account.lastSyncAt?.getTime() ?? Date.now()) / 1000) - OVERLAP_SECONDS,
      );
      let pageToken: string | undefined;
      let processed = 0;
      let errors = 0;

      do {
        const params = new URLSearchParams({
          maxResults: "50",
          includeSpamTrash: "true",
          q: `after:${since}`,
        });
        if (pageToken) params.set("pageToken", pageToken);
        const list = await gmailFetch<GmailListResponse>(
          token,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
        );

        for (const item of list.messages ?? []) {
          try {
            const message = await gmailFetch<GmailMessage>(
              token,
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=raw`,
            );
            if (!message.raw) continue;
            const labels = message.labelIds ?? [];
            const folder = chooseFolder(labels, user);
            const raw = Buffer.from(message.raw, "base64url");
            const result = await ingestImportedMime({
              user,
              raw,
              folderId: folder.id,
              markRead: !labels.includes("UNREAD"),
              markStarred: labels.includes("STARRED"),
            });
            processed += 1;
            if (result.errors.length > 0) {
              errors += 1;
              console.error(`[nyxmail:worker] gmail sync ${account.googleEmail}: ${result.errors[0]}`);
            }
            await sleep(80);
          } catch (error) {
            errors += 1;
            console.error(
              `[nyxmail:worker] gmail sync ${account.googleEmail} message ${item.id}: ${truncateError(error)}`,
            );
          }
        }
        pageToken = list.nextPageToken;
      } while (pageToken);

      if (errors === 0) {
        await prisma.gmailAccount.update({
          where: { id: account.id },
          data: { lastSyncAt: new Date() },
        });
      } else {
        // Keep the overlap window so failed messages are retried next cycle.
        await prisma.gmailAccount.update({
          where: { id: account.id },
          data: { lastSyncAt: new Date(Date.now() - OVERLAP_SECONDS * 1000) },
        });
      }
      if (processed > 0 || errors > 0) {
        console.log(
          `[nyxmail:worker] gmail sync ${account.googleEmail}: ${processed} message(s), ${errors} error(s)`,
        );
      }
    } catch (error) {
      console.error(
        `[nyxmail:worker] gmail sync ${account.googleEmail} failed: ${truncateError(error)}`,
      );
    }
  }
}
