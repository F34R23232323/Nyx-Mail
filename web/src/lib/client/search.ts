"use client";

import MiniSearch from "minisearch";
import { del, get, set } from "idb-keyval";
import type { KeyBundle } from "@nyxmail/crypto";
import type { SearchIndexItem } from "@nyxmail/shared";
import { apiFetch } from "./api";
import { decryptMail } from "./mail-crypto";

const INDEX_VERSION = 2;

export interface SearchDocument extends SearchIndexItem {
  folder: string;
}

interface StoredIndex {
  version: number;
  userId: string;
  savedAt: number;
  documents: SearchDocument[];
  serialized: string;
}

const OPTIONS = {
  fields: ["subject", "body", "from", "fromName", "to", "folder"],
  storeFields: [
    "id", "threadId", "folderId", "folderType", "from", "fromName", "to",
    "subject", "body", "date", "isRead", "isStarred", "folder",
  ],
  searchOptions: {
    boost: { subject: 3, from: 2, fromName: 2, body: 1 },
    fuzzy: 0.2,
    prefix: true,
  },
};

function indexKey(userId: string): string {
  return `nyxmail-search-v${INDEX_VERSION}-${userId}`;
}

interface RawIndexResponse {
  messages: Array<{
    id: string;
    threadId: string;
    folderId: string;
    folderType: SearchIndexItem["folderType"];
    fromAddress: string;
    fromName: string | null;
    toAddresses: string[];
    encryptedSubject: string;
    encryptedBody: string;
    wrappedKey: string;
    sentAt: string;
    isRead: boolean;
    isStarred: boolean;
  }>;
}

export async function invalidateSearchIndex(userId: string): Promise<void> {
  await del(indexKey(userId)).catch(() => undefined);
}

export async function loadSearchIndex(
  userId: string,
): Promise<{ index: MiniSearch<SearchDocument>; documents: SearchDocument[] } | null> {
  const stored = await get<StoredIndex>(indexKey(userId)).catch(() => undefined);
  if (!stored || stored.version !== INDEX_VERSION || stored.userId !== userId) return null;
  try {
    const index = MiniSearch.loadJSON<SearchDocument>(stored.serialized, OPTIONS);
    return { index, documents: stored.documents };
  } catch {
    return null;
  }
}

export async function buildSearchIndex(
  bundle: KeyBundle,
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ index: MiniSearch<SearchDocument>; documents: SearchDocument[] }> {
  const raw = await apiFetch<RawIndexResponse>("/api/v1/messages/search-index?limit=5000");
  const total = raw.messages.length;
  const documents: SearchDocument[] = [];
  const index = new MiniSearch<SearchDocument>(OPTIONS);
  let done = 0;

  for (const message of raw.messages) {
    try {
      const decrypted = await decryptMail(
        {
          id: message.id,
          threadId: message.threadId,
          folderId: message.folderId,
          folderType: message.folderType,
          fromAddress: message.fromAddress,
          fromName: message.fromName,
          toAddresses: message.toAddresses.map((email) => ({ email })),
          ccAddresses: [],
          bccAddresses: [],
          encryptedSubject: message.encryptedSubject,
          encryptedBody: message.encryptedBody,
          wrappedKey: message.wrappedKey,
          attachments: [],
          messageIdHeader: null,
          inReplyTo: null,
          references: [],
          isRead: message.isRead,
          isStarred: message.isStarred,
          isDraft: false,
          sentAt: message.sentAt,
          receivedAt: message.sentAt,
          sizeBytes: 0,
          spf: null,
          dkim: null,
          dmarc: null,
          snoozeUntil: null,
          labels: [],
        },
        bundle,
      );
      documents.push({
        id: message.id,
        threadId: message.threadId,
        folderId: message.folderId,
        folderType: message.folderType,
        from: message.fromAddress,
        fromName: message.fromName || "",
        to: message.toAddresses,
        subject: decrypted.subject,
        body: decrypted.body.text || decrypted.body.html.replace(/<[^>]+>/g, " "),
        date: new Date(message.sentAt).getTime(),
        isRead: message.isRead,
        isStarred: message.isStarred,
        folder: message.folderType,
      });
    } catch {
      // A message encrypted to an older key cannot be indexed.
    }
    done += 1;
    if (done % 8 === 0 || done === total) onProgress?.(done, total);
  }

  index.addAll(documents);
  const serialized = JSON.stringify(index);
  await set(indexKey(userId), {
    version: INDEX_VERSION,
    userId,
    savedAt: Date.now(),
    documents,
    serialized,
  } satisfies StoredIndex).catch(() => undefined);
  return { index, documents };
}
