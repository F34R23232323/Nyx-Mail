import type { ImportJob } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { sleep } from "@nyxmail/shared";
import type { GmailImportConfig } from "@nyxmail/server";
import {
  loadImportUser,
  parseCursor,
  resolveImportFolder,
  StateMonitor,
  truncateError,
  updateJobProgress,
  ingestImportedMime,
  type ImportUser,
} from "./common";

interface GmailCursor {
  pageToken?: string;
}

interface GmailMessage {
  id: string;
  raw?: string;
  labelIds?: string[];
}

export async function accessToken(config: Pick<GmailImportConfig, "refreshToken">): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured on the server");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google access token refresh failed");
  }
  return data.access_token;
}

export async function gmailFetch<T>(token: string, url: string, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.ok) return (await response.json()) as T;

  const detail = await response.text().catch(() => "");
  const retryable =
    response.status === 429 ||
    response.status === 503 ||
    (response.status === 403 &&
      /quota|rate limit|ratelimitexceeded|userratelimitexceeded/i.test(detail));
  if (retryable && attempt < 7) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const delay = retryAfter > 0
      ? Math.min(60, retryAfter) * 1000
      : Math.min(60_000, 2_000 * 2 ** attempt) + Math.floor(Math.random() * 500);
    await sleep(delay);
    return gmailFetch<T>(token, url, attempt + 1);
  }
  throw new Error(`Gmail API ${response.status}: ${detail.slice(0, 300)}`);
}

export function chooseFolder(labels: string[], user: ImportUser): { id: string; name: string; type: string } {
  const folderByType = (type: string) => user.folders.find((folder) => folder.type === type);
  if (labels.includes("SENT")) return folderByType("SENT") ?? folderByType("INBOX")!;
  if (labels.includes("DRAFT")) return folderByType("DRAFTS") ?? folderByType("INBOX")!;
  if (labels.includes("SPAM")) return folderByType("SPAM") ?? folderByType("INBOX")!;
  if (labels.includes("TRASH")) return folderByType("TRASH") ?? folderByType("INBOX")!;
  return folderByType("INBOX")!;
}

export async function runGmailImport(job: ImportJob): Promise<void> {
  const config = decryptJson<GmailImportConfig>(String(job.config));
  const user = await loadImportUser(job.userId);
  const monitor = new StateMonitor(job.id);
  const token = await accessToken(config);
  const cursor = parseCursor<GmailCursor>(job, {});

  const profile = await gmailFetch<{ messagesTotal?: number }>(
    token,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
  const total = Number(profile.messagesTotal || 0);
  await updateJobProgress(job.id, { total });

  let pageToken = cursor.pageToken;
  const pageSize = 100;
  do {
    await monitor.check(true);
    const params = new URLSearchParams({
      maxResults: String(pageSize),
      includeSpamTrash: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const list = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    );
    const ids = (list.messages ?? []).map((message) => message.id);
    let processed = 0;

    for (let i = 0; i < ids.length; i += 3) {
      await monitor.check(true);
      const slice = ids.slice(i, i + 3);
      const detailed = await Promise.all(
        slice.map(async (id) => {
          try {
            const message = await gmailFetch<GmailMessage>(
              token,
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=raw`,
            );
            return message;
          } catch (error) {
            await updateJobProgress(job.id, { error: `Gmail ${id}: ${truncateError(error)}` });
            return null;
          }
        }),
      );
      for (const message of detailed) {
        if (!message?.raw) continue;
        const labels = message.labelIds ?? [];
        const folder = chooseFolder(labels, user);
        try {
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
            await updateJobProgress(job.id, { error: result.errors[0] });
          }
        } catch (error) {
          await updateJobProgress(job.id, {
            error: `Gmail ${message.id}: ${truncateError(error)}`,
          });
        }
      }
      await sleep(300);
      await monitor.check();
    }
    pageToken = list.nextPageToken;
    await updateJobProgress(job.id, {
      processedDelta: processed,
      cursor: JSON.stringify({ pageToken: pageToken ?? null }),
    });
  } while (pageToken);
}
