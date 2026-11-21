import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { decryptMail } from "../lib/mail";
import { htmlToText, truncate } from "../lib/format";
import type { DecryptedMail, ThreadDTO } from "../lib/types";

export interface MailListItem {
  thread: ThreadDTO;
  decrypted: DecryptedMail | null;
}

export function useMailList(folder: string, label?: string) {
  const { keys } = useAuth();
  const [items, setItems] = useState<MailListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const requestId = useRef(0);
  const cache = useRef(new Map<string, DecryptedMail>());
  const nextPageRef = useRef<number | null>(null);
  nextPageRef.current = nextPage;

  const decryptThreads = useCallback(
    async (threads: ThreadDTO[]): Promise<MailListItem[]> => {
      if (!keys) return threads.map((thread) => ({ thread, decrypted: null }));
      return Promise.all(
        threads.map(async (thread) => {
          const cached = cache.current.get(thread.latest.id);
          if (cached) return { thread, decrypted: cached };
          const decrypted = await decryptMail(thread.latest, keys);
          cache.current.set(thread.latest.id, decrypted);
          if (cache.current.size > 800) {
            const oldest = cache.current.keys().next().value;
            if (oldest) cache.current.delete(oldest);
          }
          return { thread, decrypted };
        }),
      );
    },
    [keys],
  );

  const fetchPage = useCallback(
    async (page: number, mode: "replace" | "append" | "refresh") => {
      if (!keys) return;
      const id = ++requestId.current;
      if (mode === "replace") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      if (mode === "append") setLoadingMore(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          folder,
          page: String(page),
          pageSize: "30",
        });
        if (label) query.set("label", label);
        const data = await apiFetch<{ items: ThreadDTO[]; nextPage: number | null }>(
          `/api/v1/threads?${query.toString()}`,
        );
        const enriched = await decryptThreads(data.items);
        if (id !== requestId.current) return;
        setItems((current) => {
          if (mode === "append") {
            const seen = new Set(current.map((item) => item.thread.id));
            return [...current, ...enriched.filter((item) => !seen.has(item.thread.id))];
          }
          return enriched;
        });
        setNextPage(data.nextPage);
      } catch (caught) {
        if (id !== requestId.current) return;
        setError(caught instanceof Error ? caught.message : "Inbox could not be loaded");
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [decryptThreads, folder, keys, label],
  );

  useEffect(() => {
    setItems([]);
    setNextPage(null);
    void fetchPage(1, "replace");
  }, [fetchPage]);

  const refresh = useCallback(async () => {
    await fetchPage(1, "refresh");
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || refreshing || !nextPageRef.current) return;
    await fetchPage(nextPageRef.current, "append");
  }, [fetchPage, loading, loadingMore, refreshing]);

  const mutateThread = useCallback((threadId: string, mutate: (thread: ThreadDTO) => ThreadDTO) => {
    setItems((current) =>
      current.map((item) =>
        item.thread.id === threadId ? { ...item, thread: mutate(item.thread) } : item,
      ),
    );
  }, []);

  const removeThread = useCallback((threadId: string) => {
    setItems((current) => current.filter((item) => item.thread.id !== threadId));
  }, []);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    nextPage,
    refresh,
    loadMore,
    mutateThread,
    removeThread,
    reload: () => fetchPage(1, "replace"),
  };
}

export function previewOf(item: MailListItem): { subject: string; snippet: string } {
  if (!item.decrypted) {
    return { subject: "Encrypted message", snippet: "Unlock your keys to read this message." };
  }
  const text = item.decrypted.body.text || htmlToText(item.decrypted.body.html);
  return {
    subject: item.decrypted.subject || "(no subject)",
    snippet: truncate(text || "No message body", 120),
  };
}
