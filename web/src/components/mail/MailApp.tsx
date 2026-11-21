"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  CheckCheck,
  FileText,
  FolderInput,
  Inbox,
  Keyboard,
  LogOut,
  Mail,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import type {
  AliasDTO,
  ContactDTO,
  EncryptedMessageDTO,
  FolderDTO,
  LabelDTO,
  ThreadDTO,
} from "@nyxmail/shared";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { useToast } from "@/lib/client/toast";
import { useUnreadBadge, showBrowserNotification } from "@/lib/client/useUnreadBadge";
import { buildTrainingSample, decryptMail, type DecryptedMail } from "@/lib/client/mail-crypto";
import {
  buildSearchIndex,
  invalidateSearchIndex,
  loadSearchIndex,
  type SearchDocument,
} from "@/lib/client/search";
import { cn, truncate } from "@/lib/client/utils";
import type MiniSearch from "minisearch";
import { Sidebar } from "./Sidebar";
import { MailList, type SubjectPreview } from "./MailList";
import { ReadingPane } from "./ReadingPane";
import { TopBar } from "./TopBar";
import { AppRail } from "./AppRail";
import {
  ComposeModal,
  type ComposeSeed,
  type GmailAccountSummary,
} from "./ComposeModal";
import { ContactsModal, ShortcutHelp } from "./ContactsModal";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { ConfirmDialog, type ConfirmTone } from "@/components/ui/ConfirmDialog";
import { CommandPalette, type CommandItem } from "@/components/ui/CommandPalette";
import { useTheme } from "@/lib/client/theme";
import { UnlockGate } from "@/components/auth/UnlockGate";

interface ThreadResponse {
  thread: { id: string; lastActivityAt: string; messageCount: number };
  messages: EncryptedMessageDTO[];
}

interface ComposeState {
  key: string;
  seed: ComposeSeed;
}

interface CreateDialog {
  kind: "folder" | "label";
}

interface ConfirmState {
  title: string;
  description?: string;
  label: string;
  tone?: ConfirmTone;
  icon?: React.ReactNode;
  count?: number;
  details?: Array<{ label: string; value: string }>;
  onConfirm: () => Promise<void>;
}

type ThreadAction =
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "archive"
  | "trash"
  | "spam"
  | "notSpam"
  | "inbox"
  | "move"
  | "snooze";

export function MailApp() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading, logout, refreshUser } = useAuth();
  const { bundle, ready } = useCrypto();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const activeFolderParam = params.get("folder") || "INBOX";
  const activeLabelId = params.get("label");
  const selectedThreadId = params.get("thread");
  const activeFolderRef = useRef(activeFolderParam);

  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [labels, setLabels] = useState<LabelDTO[]>([]);
  const [aliases, setAliases] = useState<AliasDTO[]>([]);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccountSummary[]>([]);
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const [threads, setThreads] = useState<ThreadDTO[]>([]);
  const [previews, setPreviews] = useState<Record<string, SubjectPreview>>({});
  const [threadMessages, setThreadMessages] = useState<DecryptedMail[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileReader, setMobileReader] = useState(Boolean(selectedThreadId));
  const [contactsOpen, setContactsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [createDialog, setCreateDialog] = useState<CreateDialog | null>(null);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#6D4AFF");
  const [createBusy, setCreateBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState | null>(null);
  const [query, setQuery] = useState("");
  const [categoryInfo, setCategoryInfo] = useState({ label: "Primary", count: 0 });
  const [searchResults, setSearchResults] = useState<SearchDocument[] | null>(null);
  const [searchBuilding, setSearchBuilding] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ done: number; total: number } | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const previewCache = useRef(new Map<string, SubjectPreview>());
  const searchIndexRef = useRef<{ index: MiniSearch<SearchDocument>; documents: SearchDocument[] } | null>(null);
  const markedRead = useRef(new Set<string>());
  const gPressed = useRef<number>(0);
  const unreadOnlyRef = useRef(false);
  const threadRequestId = useRef(0);

  activeFolderRef.current = activeFolderParam;
  useUnreadBadge(unread);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/mail")}`);
    }
  }, [authLoading, user, router]);

  const currentFolder = useMemo(() => {
    return (
      folders.find((folder) => folder.id === activeFolderParam) ??
      folders.find((folder) => folder.type === activeFolderParam) ??
      null
    );
  }, [folders, activeFolderParam]);
  const activeLabel = useMemo(
    () => labels.find((label) => label.id === activeLabelId) ?? null,
    [labels, activeLabelId],
  );

  const title = activeLabel
    ? activeLabel.name
    : activeFolderParam === "ALL"
      ? "All mail"
      : activeFolderParam === "STARRED"
        ? "Starred"
        : currentFolder?.name ?? "Inbox";

  const folderKind = useMemo(() => {
    if (searchResults !== null) return "search" as const;
    if (activeFolderParam === "STARRED") return "starred" as const;
    if (activeFolderParam === "TRASH" || currentFolder?.type === "TRASH") return "trash" as const;
    if (activeFolderParam === "INBOX" || activeFolderParam === "ALL" || activeLabelId) {
      return "inbox" as const;
    }
    return "folder" as const;
  }, [searchResults, activeFolderParam, currentFolder?.type, activeLabelId]);

  const loadMeta = useCallback(async () => {
    const [folderData, labelData, aliasData, gmailData, contactData] = await Promise.all([
      apiFetch<{ folders: FolderDTO[] }>("/api/v1/folders").catch(() => ({ folders: [] })),
      apiFetch<{ labels: LabelDTO[] }>("/api/v1/labels").catch(() => ({ labels: [] })),
      apiFetch<{ aliases: AliasDTO[] }>("/api/v1/aliases").catch(() => ({ aliases: [] })),
      apiFetch<{ accounts: GmailAccountSummary[] }>("/api/v1/imports/gmail/accounts")
        .catch(() => ({ accounts: [] })),
      apiFetch<{ contacts: ContactDTO[] }>("/api/v1/contacts?limit=200").catch(() => ({ contacts: [] })),
    ]);
    setFolders(folderData.folders);
    setLabels(labelData.labels);
    setAliases(aliasData.aliases);
    setGmailAccounts(gmailData.accounts);
    setContacts(contactData.contacts);
  }, []);

  const refreshFolders = useCallback(async () => {
    const data = await apiFetch<{ folders: FolderDTO[] }>("/api/v1/folders").catch(() => null);
    if (data) {
      setFolders(data.folders);
      const inbox = data.folders.find((folder) => folder.type === "INBOX");
      if (inbox) setUnread(inbox.unreadCount ?? 0);
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    const data = await apiFetch<{ unread: number }>("/api/v1/messages/unread-count").catch(() => null);
    if (data) setUnread(data.unread);
  }, []);

  useEffect(() => {
    if (user) void loadMeta();
  }, [user?.id, loadMeta]);

  useEffect(() => {
    if (!user) return;
    void refreshUnread();
  }, [user?.id, refreshUnread]);

  const buildThreadQuery = useCallback(() => {
    const search = new URLSearchParams({ pageSize: "30" });
    search.set("folder", activeLabelId ? "ALL" : activeFolderParam);
    if (activeLabelId) search.set("label", activeLabelId);
    if (unreadOnlyRef.current) search.set("unread", "1");
    return search.toString();
  }, [activeFolderParam, activeLabelId]);

  const loadThreads = useCallback(
    async (page: number, append: boolean) => {
      if (!user) return;
      const requestId = append ? threadRequestId.current : ++threadRequestId.current;
      if (append) setLoadingMore(true);
      else setListLoading(true);
      try {
        const data = await apiFetch<{ items: ThreadDTO[]; nextPage: number | null }>(
          `/api/v1/threads?${buildThreadQuery()}&page=${page}`,
        );
        if (requestId !== threadRequestId.current) return;
        setThreads((current) => (append ? [...current, ...data.items] : data.items));
        setNextPage(data.nextPage);
      } catch (caught) {
        if (requestId !== threadRequestId.current) return;
        if (!(caught instanceof ApiClientError && caught.status === 401)) {
          toast({ title: "Could not load conversations", tone: "error" });
        }
      } finally {
        if (requestId === threadRequestId.current) {
          setListLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [user, buildThreadQuery, toast],
  );

  const setUnreadFilter = useCallback(
    (value: boolean) => {
      if (unreadOnlyRef.current === value) return;
      unreadOnlyRef.current = value;
      setUnreadOnly(value);
      setSelected(new Set());
      setThreads([]);
      setPreviews({});
      void loadThreads(1, false);
    },
    [loadThreads],
  );

  useEffect(() => {
    setSelected(new Set());
    setSearchResults(null);
    setQuery("");
    setThreads([]);
    setPreviews({});
    unreadOnlyRef.current = false;
    setUnreadOnly(false);
    void loadThreads(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderParam, activeLabelId, user?.id]);

  useEffect(() => {
    if (refreshKey > 0) void loadThreads(1, false);
    // A refresh should not clear the user's active search or selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (!bundle || threads.length === 0) return;
    let cancelled = false;
    const missing = threads.filter((thread) => !previewCache.current.has(thread.latest.id));
    if (missing.length === 0) {
      setPreviews((current) => {
        const next = { ...current };
        for (const thread of threads) {
          const cached = previewCache.current.get(thread.latest.id);
          if (cached) next[thread.id] = cached;
        }
        return next;
      });
      return;
    }
    (async () => {
      const updates: Record<string, SubjectPreview> = {};
      for (let index = 0; index < missing.length; index += 6) {
        const batch = missing.slice(index, index + 6);
        await Promise.all(
          batch.map(async (thread) => {
            try {
              const decrypted = await decryptMail(thread.latest, bundle);
              const text = decrypted.body.text || decrypted.body.html.replace(/<[^>]+>/g, " ");
              const preview = {
                subject: decrypted.subject,
                snippet: truncate(text.replace(/\s+/g, " ").trim(), 160),
              };
              previewCache.current.set(thread.latest.id, preview);
              updates[thread.id] = preview;
            } catch {
              updates[thread.id] = { subject: "Encrypted message", snippet: "Unable to decrypt with this key." };
            }
          }),
        );
        if (cancelled) return;
        setPreviews((current) => ({ ...current, ...updates }));
      }
      if (!cancelled) setPreviews((current) => ({ ...current, ...updates }));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [threads, bundle]);

  useEffect(() => {
    if (!selectedThreadId || !bundle) {
      setThreadMessages([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    (async () => {
      try {
        const data = await apiFetch<ThreadResponse>(`/api/v1/threads/${selectedThreadId}`);
        const decrypted = await Promise.all(data.messages.map((message) => decryptMail(message, bundle)));
        if (cancelled) return;
        setThreadMessages(decrypted);
        const hasUnread = decrypted.some((message) => !message.dto.isRead);
        if (hasUnread && !markedRead.current.has(selectedThreadId)) {
          markedRead.current.add(selectedThreadId);
          window.setTimeout(() => {
            void apiFetch(`/api/v1/threads/${selectedThreadId}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "read" }),
            }).then(() => {
              setThreadMessages((current) =>
                current.map((message) => ({ ...message, dto: { ...message.dto, isRead: true } })),
              );
              setThreads((current) =>
                current.map((thread) =>
                  thread.id === selectedThreadId
                    ? {
                        ...thread,
                        unreadCount: 0,
                        latest: { ...thread.latest, isRead: true },
                      }
                    : thread,
                ),
              );
              void refreshUnread();
            }).catch(() => undefined);
          }, 700);
        }
      } catch (caught) {
        if (!cancelled) {
          toast({ title: "Conversation could not be opened", tone: "error" });
          updateThreadParam(null);
        }
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId, bundle]);

  useEffect(() => {
    if (!user) return;
    const source = new EventSource("/api/v1/events");
    const onUnread = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { unread?: number };
        if (typeof data.unread === "number") setUnread(data.unread);
      } catch {
        // ignore malformed events
      }
    };
    const onMail = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { threadId?: string; unread?: number };
        if (typeof data.unread === "number") setUnread(data.unread);
        setRefreshKey((key) => key + 1);
        void invalidateSearchIndex(user.id);
        searchIndexRef.current = null;
        setSearchVersion((version) => version + 1);
        const notifications = window.localStorage.getItem("nyxmail-browser-notifications") === "1";
        if (notifications) {
          showBrowserNotification("New encrypted mail", "Open NyxMail to decrypt it locally.", "nyxmail-mail");
        }
        if (document.visibilityState === "visible") {
          toast({
            title: "New encrypted mail",
            description: "A message was sealed to your public key.",
            tone: "info",
            action: {
              label: "View inbox",
              onClick: () => {
                if (activeFolderRef.current !== "INBOX") navigateToFolder("INBOX");
              },
            },
          });
        }
        void refreshFolders();
      } catch {
        // ignore
      }
    };
    source.addEventListener("unread", onUnread as EventListener);
    source.addEventListener("mail", onMail as EventListener);
    return () => {
      source.removeEventListener("unread", onUnread as EventListener);
      source.removeEventListener("mail", onMail as EventListener);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!bundle || !user) return;
    if (query.trim().length < 2) {
      setSearchResults(null);
      setSearchBuilding(false);
      setSearchProgress(null);
      return;
    }
    setSearchResults([]);
    setSearchBuilding(true);
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        let data = searchIndexRef.current;
        if (!data) {
          data = await loadSearchIndex(user.id);
          if (!data) {
            setSearchProgress({ done: 0, total: 0 });
            data = await buildSearchIndex(bundle, user.id, (done, total) => {
              if (!cancelled) setSearchProgress({ done, total });
            });
          }
          searchIndexRef.current = data;
        }
        if (cancelled) return;
        const raw = data.index.search(query.trim(), { prefix: true, fuzzy: 0.2 }).slice(0, 100);
        const docs = raw
          .map((result) => data.documents.find((document) => document.id === result.id))
          .filter((document): document is SearchDocument => Boolean(document));
        setSearchResults(docs);
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          toast({ title: "Could not build the local search index", tone: "error" });
        }
      } finally {
        if (!cancelled) {
          setSearchBuilding(false);
          setSearchProgress(null);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, bundle, user, searchVersion, toast]);

  const navigateWith = useCallback(
    (updates: { folder?: string | null; label?: string | null; thread?: string | null }) => {
      const search = new URLSearchParams(params.toString());
      if (updates.folder !== undefined) {
        if (updates.folder) search.set("folder", updates.folder);
        else search.delete("folder");
      }
      if (updates.label !== undefined) {
        if (updates.label) search.set("label", updates.label);
        else search.delete("label");
      }
      if (updates.thread !== undefined) {
        if (updates.thread) search.set("thread", updates.thread);
        else search.delete("thread");
      }
      router.push(`/mail?${search.toString()}`);
    },
    [params, router],
  );

  const navigateToFolder = (folder: string) => {
    setMobileNav(false);
    setMobileReader(false);
    navigateWith({ folder, label: null, thread: null });
  };
  const selectLabel = (labelId: string | null) => {
    setMobileNav(false);
    setMobileReader(false);
    navigateWith({ folder: labelId ? "ALL" : null, label: labelId, thread: null });
  };
  const updateThreadParam = (threadId: string | null) => {
    setMobileReader(Boolean(threadId));
    navigateWith({ thread: threadId });
  };

  const openCompose = (seed: ComposeSeed) => {
    if (!bundle) return;
    setCompose({ seed, key: `${seed.mode}-${seed.source?.dto.id ?? "new"}-${Date.now()}` });
  };

  const handleCategoryChange = useCallback((label: string, count: number) => {
    setCategoryInfo((current) =>
      current.label === label && current.count === count ? current : { label, count },
    );
  }, []);

  const onSent = async () => {
    setCompose(null);
    setSearchVersion((version) => version + 1);
    void invalidateSearchIndex(user!.id);
    searchIndexRef.current = null;
    setRefreshKey((key) => key + 1);
    await Promise.all([loadMeta(), refreshFolders(), refreshUnread(), refreshUser()]);
  };

  const runThreadAction = async (
    threadId: string,
    action: ThreadAction,
    options?: { folderId?: string; snoozeUntil?: string | null },
    behavior: { silent?: boolean; close?: boolean } = {},
  ) => {
    const thread = threads.find((item) => item.id === threadId);
    const latest = thread?.latest;
    const destructive = ["archive", "trash", "spam", "notSpam", "move", "snooze", "inbox"].includes(action);
    if (action === "star" || action === "unstar") {
      setThreads((current) =>
        current.map((item) =>
          item.id === threadId
            ? { ...item, latest: { ...item.latest, isStarred: action === "star" } }
            : item,
        ),
      );
      if (selectedThreadId === threadId) {
        setThreadMessages((current) =>
          current.map((message) => ({
            ...message,
            dto: { ...message.dto, isStarred: action === "star" },
          })),
        );
      }
    }
    if (action === "read" || action === "unread") {
      setThreads((current) =>
        current.map((item) =>
          item.id === threadId
            ? { ...item, unreadCount: action === "read" ? 0 : Math.max(1, item.unreadCount), latest: { ...item.latest, isRead: action === "read" } }
            : item,
        ),
      );
      if (selectedThreadId === threadId) {
        setThreadMessages((current) =>
          current.map((message) => ({ ...message, dto: { ...message.dto, isRead: action === "read" } })),
        );
      }
    }
    if (destructive) {
      setThreads((current) => current.filter((item) => item.id !== threadId));
      if (selectedThreadId === threadId) {
        updateThreadParam(null);
        setThreadMessages([]);
      }
    }
    try {
      if ((action === "spam" || action === "notSpam") && latest) {
        const sample =
          bundle
            ? await buildTrainingSample(latest, bundle).catch(() => undefined)
            : undefined;
        const endpoint = action === "spam" ? "report-spam" : "report-ham";
        await apiFetch(`/api/v1/messages/${latest.id}/${endpoint}`, {
          method: "POST",
          body: JSON.stringify(sample ? { sample } : {}),
        }).catch(() => undefined);
      }
      await apiFetch(`/api/v1/threads/${threadId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, ...options }),
      });
      await Promise.all([refreshFolders(), refreshUnread()]);
      if (destructive) {
        setRefreshKey((key) => key + 1);
        if (!behavior.silent) {
          const label =
            action === "archive"
              ? "Conversation archived"
              : action === "trash"
                ? "Moved to Trash"
                : action === "spam"
                  ? "Reported as spam"
                  : action === "notSpam"
                    ? "Marked as not spam"
                    : action === "snooze"
                      ? "Conversation snoozed"
                      : "Conversation moved";
          toast({
            title: label,
            tone: action === "trash" || action === "spam" ? "warning" : "success",
            action: {
              label: "Undo",
              onClick: async () => {
                await apiFetch(`/api/v1/threads/${threadId}`, {
                  method: "PATCH",
                  body: JSON.stringify(
                    action === "snooze"
                      ? { action: "snooze", snoozeUntil: null }
                      : action === "notSpam"
                        ? { action: "spam" }
                        : latest?.folderId
                          ? { action: "move", folderId: latest.folderId }
                          : { action: "inbox" },
                  ),
                }).catch(() => undefined);
                setRefreshKey((key) => key + 1);
                void refreshFolders();
              },
            },
          });
        }
      } else if (!behavior.silent) {
        if (action === "read" || action === "unread") {
          toast({ title: `Marked ${action}`, tone: "success" });
        }
      }
    } catch (caught) {
      toast({
        title: "Action failed",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
      setRefreshKey((key) => key + 1);
    }
  };

  const runMessageAction = async (
    messageId: string,
    action: "read" | "unread" | "star" | "unstar" | "trash",
  ) => {
    if (action === "trash") {
      try {
        await apiFetch(`/api/v1/messages/${messageId}`, { method: "DELETE" });
        setThreadMessages((current) => current.filter((message) => message.dto.id !== messageId));
        if (threadMessages.length <= 1) {
          updateThreadParam(null);
          setThreadMessages([]);
        }
        setRefreshKey((key) => key + 1);
        void refreshFolders();
        const inbox = folders.find((folder) => folder.type === "INBOX");
        toast({
          title: "Message moved to Trash",
          tone: "warning",
          action: inbox
            ? {
                label: "Undo",
                onClick: async () => {
                  await apiFetch(`/api/v1/messages/${messageId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ folderId: inbox.id }),
                  }).catch(() => undefined);
                  setRefreshKey((key) => key + 1);
                },
              }
            : undefined,
        });
      } catch {
        toast({ title: "Could not delete message", tone: "error" });
      }
      return;
    }
    const read = action === "read" ? true : action === "unread" ? false : undefined;
    const starred = action === "star" ? true : action === "unstar" ? false : undefined;
    setThreadMessages((current) =>
      current.map((message) =>
        message.dto.id === messageId
          ? {
              ...message,
              dto: {
                ...message.dto,
                ...(read !== undefined ? { isRead: read } : {}),
                ...(starred !== undefined ? { isStarred: starred } : {}),
              },
            }
          : message,
      ),
    );
    try {
      await apiFetch(`/api/v1/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(read !== undefined ? { isRead: read } : {}),
          ...(starred !== undefined ? { isStarred: starred } : {}),
        }),
      });
      setThreads((current) =>
        current.map((thread) =>
          thread.latest.id === messageId
            ? {
                ...thread,
                latest: {
                  ...thread.latest,
                  ...(read !== undefined ? { isRead: read } : {}),
                  ...(starred !== undefined ? { isStarred: starred } : {}),
                },
              }
            : thread,
        ),
      );
      void refreshUnread();
    } catch {
      toast({ title: "Action failed", tone: "error" });
      setRefreshKey((key) => key + 1);
    }
  };

  const toggleLabel = async (labelId: string, add: boolean) => {
    if (!selectedThreadId) return;
    try {
      await apiFetch(`/api/v1/threads/${selectedThreadId}/labels`, {
        method: "POST",
        body: JSON.stringify({ labelId, add }),
      });
      const label = labels.find((item) => item.id === labelId);
      setThreadMessages((current) =>
        current.map((message) => ({
          ...message,
          dto: {
            ...message.dto,
            labels: add
              ? [...message.dto.labels.filter((item) => item.id !== labelId), ...(label ? [label] : [])]
              : message.dto.labels.filter((item) => item.id !== labelId),
          },
        })),
      );
      setThreads((current) =>
        current.map((thread) =>
          thread.id === selectedThreadId
            ? {
                ...thread,
                latest: {
                  ...thread.latest,
                  labels: add
                    ? [...thread.latest.labels.filter((item) => item.id !== labelId), ...(label ? [label] : [])]
                    : thread.latest.labels.filter((item) => item.id !== labelId),
                },
              }
            : thread,
        ),
      );
      toast({ title: add ? "Label applied" : "Label removed", tone: "success" });
    } catch {
      toast({ title: "Could not update label", tone: "error" });
    }
  };

  const deleteThreadsForever = async (ids: string[]) => {
    if (ids.length === 0) return;
    const deletedIds: string[] = [];
    await Promise.all(
      ids.map(async (threadId) => {
        try {
          const data = await apiFetch<ThreadResponse>(`/api/v1/threads/${threadId}`);
          await Promise.all(
            data.messages.map((message) =>
              apiFetch(`/api/v1/messages/${message.id}?permanent=true`, { method: "DELETE" }),
            ),
          );
          deletedIds.push(threadId);
        } catch {
          // keep deleting the rest
        }
      }),
    );
    setThreads((current) => current.filter((thread) => !deletedIds.includes(thread.id)));
    if (selectedThreadId && deletedIds.includes(selectedThreadId)) {
      updateThreadParam(null);
      setThreadMessages([]);
    }
    setSelected(new Set());
    await Promise.all([refreshFolders(), refreshUnread()]);
    setRefreshKey((key) => key + 1);
    toast({
      title:
        deletedIds.length === ids.length
          ? `${deletedIds.length} conversation${deletedIds.length === 1 ? "" : "s"} deleted forever`
          : `${deletedIds.length} of ${ids.length} conversations deleted`,
      tone: deletedIds.length === ids.length ? "success" : "warning",
    });
  };

  const requestThreadRemove = (threadId: string, subject?: string) => {
    const isTrash = folderKind === "trash";
    setConfirmDialog({
      title: isTrash ? "Delete this conversation forever?" : "Move this conversation to Trash?",
      description: isTrash
        ? "The conversation and its encrypted attachments will be permanently removed. This cannot be undone."
        : "You can undo this right away. Messages in Trash are permanently removed after 30 days.",
      label: isTrash ? "Delete forever" : "Move to Trash",
      tone: "danger",
      icon: <Trash2 className="h-5 w-5" />,
      details: subject ? [{ label: "Conversation", value: subject }] : undefined,
      onConfirm: async () => {
        if (isTrash) await deleteThreadsForever([threadId]);
        else await runThreadAction(threadId, "trash");
        setConfirmDialog(null);
      },
    });
  };

  const requestMessageRemove = (messageId: string, subject?: string) => {
    const isTrash = folderKind === "trash";
    setConfirmDialog({
      title: isTrash ? "Delete this message forever?" : "Move this message to Trash?",
      description: isTrash
        ? "This permanently removes the message and its encrypted attachments. This cannot be undone."
        : "You can undo this right away. Messages in Trash are permanently removed after 30 days.",
      label: isTrash ? "Delete forever" : "Move to Trash",
      tone: "danger",
      icon: <Trash2 className="h-5 w-5" />,
      details: subject ? [{ label: "Message", value: subject }] : undefined,
      onConfirm: async () => {
        if (isTrash) {
          await apiFetch(`/api/v1/messages/${messageId}?permanent=true`, { method: "DELETE" });
          setThreadMessages((current) => current.filter((message) => message.dto.id !== messageId));
          if (threadMessages.length <= 1) {
            updateThreadParam(null);
            setThreadMessages([]);
          }
          setRefreshKey((key) => key + 1);
          await Promise.all([refreshFolders(), refreshUnread()]);
          toast({ title: "Message deleted forever", tone: "success" });
        } else {
          await runMessageAction(messageId, "trash");
        }
        setConfirmDialog(null);
      },
    });
  };

  const performBulkAction = async (
    action: "read" | "unread" | "archive" | "trash" | "star" | "unstar" | "move",
    folderId?: string,
    folderName?: string,
  ) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "trash" && folderKind === "trash") {
      await deleteThreadsForever(ids);
      return;
    }
    const originals: Array<{ id: string; folderId: string }> = [];
    for (const id of ids) {
      const folderId = threads.find((thread) => thread.id === id)?.latest.folderId;
      if (folderId) originals.push({ id, folderId });
    }
    setSelected(new Set());
    await Promise.all(
      ids.map((id) =>
        runThreadAction(
          id,
          action === "move" ? "move" : action,
          folderId ? { folderId } : undefined,
          { silent: true },
        ),
      ),
    );
    toast({
      title:
        action === "archive"
          ? `${ids.length} conversation${ids.length === 1 ? "" : "s"} archived`
          : action === "trash"
            ? `${ids.length} conversation${ids.length === 1 ? "" : "s"} moved to Trash`
            : action === "read" || action === "unread"
              ? `${ids.length} conversation${ids.length === 1 ? "" : "s"} marked ${action}`
              : action === "star" || action === "unstar"
                ? `${ids.length} conversation${ids.length === 1 ? "" : "s"} ${action === "star" ? "starred" : "unstarred"}`
                : `${ids.length} conversation${ids.length === 1 ? "" : "s"} moved to ${folderName ?? "folder"}`,
      tone: action === "trash" ? "warning" : "success",
      action:
        (action === "archive" || action === "trash" || action === "move") && originals.length > 0
          ? {
              label: "Undo",
              onClick: async () => {
                await Promise.allSettled(
                  originals.map((original) =>
                    apiFetch(`/api/v1/threads/${original.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ action: "move", folderId: original.folderId }),
                    }),
                  ),
                );
                setRefreshKey((key) => key + 1);
                await Promise.all([refreshFolders(), refreshUnread()]);
                toast({ title: "Conversations restored", tone: "success" });
              },
            }
          : undefined,
    });
  };

  const requestBulkAction = (
    action: "read" | "unread" | "archive" | "trash" | "star" | "unstar" | "move",
    folderId?: string,
    folderName?: string,
  ) => {
    const count = selected.size;
    if (count === 0) return;
    const isPermanent = action === "trash" && folderKind === "trash";
    if (action === "trash" || action === "archive" || action === "move") {
      setConfirmDialog({
        title: isPermanent
          ? `Delete ${count} conversation${count === 1 ? "" : "s"} forever?`
          : action === "archive"
            ? `Archive ${count} conversation${count === 1 ? "" : "s"}?`
            : action === "trash"
              ? `Move ${count} conversation${count === 1 ? "" : "s"} to Trash?`
              : `Move ${count} conversation${count === 1 ? "" : "s"}?`,
        description: isPermanent
          ? "The selected conversations and their encrypted attachments will be permanently removed. This cannot be undone."
          : action === "archive"
            ? "The selected conversations leave your inbox but stay searchable in Archive."
            : action === "trash"
              ? "You can restore them from Trash within 30 days."
              : `They will be moved to ${folderName ?? "the selected folder"}. This does not delete them.`,
        label: isPermanent
          ? "Delete forever"
          : action === "archive"
            ? "Archive"
            : action === "trash"
              ? "Move to Trash"
              : "Move",
        tone: isPermanent || action === "trash" ? "danger" : "accent",
        icon: isPermanent || action === "trash" ? <Trash2 className="h-5 w-5" /> : action === "archive" ? <Archive className="h-5 w-5" /> : <FolderInput className="h-5 w-5" />,
        count,
        onConfirm: async () => {
          await performBulkAction(action, folderId, folderName);
          setConfirmDialog(null);
        },
      });
      return;
    }
    void performBulkAction(action, folderId, folderName);
  };

  const replyToCurrent = (mode: "reply" | "replyAll" | "forward") => {
    const latestMessage = threadMessages[threadMessages.length - 1];
    if (!latestMessage) return;
    openCompose({
      mode,
      source: latestMessage,
      threadId: mode === "forward" ? null : latestMessage.dto.threadId,
    });
  };

  const markAllRead = async () => {
    const unreadThreads = threads.filter(
      (thread) => thread.unreadCount > 0 || !thread.latest.isRead,
    );
    if (unreadThreads.length === 0) {
      toast({ title: "Everything is already read", tone: "info" });
      return;
    }
    await Promise.all(
      unreadThreads.map((thread) =>
        runThreadAction(thread.id, "read", undefined, { silent: true }),
      ),
    );
    setThreads((current) =>
      current.map((thread) => ({
        ...thread,
        unreadCount: 0,
        latest: { ...thread.latest, isRead: true },
      })),
    );
    toast({
      title: `${unreadThreads.length} conversation${unreadThreads.length === 1 ? "" : "s"} marked read`,
      tone: "success",
    });
  };

  const createItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createDialog || !createName.trim()) return;
    setCreateBusy(true);
    try {
      if (createDialog.kind === "folder") {
        await apiFetch("/api/v1/folders", {
          method: "POST",
          body: JSON.stringify({ name: createName.trim() }),
        });
        toast({ title: "Folder created", tone: "success" });
      } else {
        await apiFetch("/api/v1/labels", {
          method: "POST",
          body: JSON.stringify({ name: createName.trim(), color: createColor }),
        });
        toast({ title: "Label created", tone: "success" });
      }
      setCreateDialog(null);
      setCreateName("");
      await loadMeta();
    } catch (caught) {
      toast({
        title: createDialog.kind === "folder" ? "Could not create folder" : "Could not create label",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setCreateBusy(false);
    }
  };

  const requestDeleteFolder = (folder: FolderDTO) => {
    setConfirmDialog({
      title: `Delete “${folder.name}”?`,
      description: "Messages in this folder will be moved to Archive. The folder itself is removed.",
      label: "Delete folder",
      tone: "danger",
      icon: <Trash2 className="h-5 w-5" />,
      details: [{ label: "Folder", value: folder.name }],
      onConfirm: async () => {
        await apiFetch(`/api/v1/folders/${folder.id}`, { method: "DELETE" });
        if (activeFolderParam === folder.id) navigateToFolder("INBOX");
        await loadMeta();
        setConfirmDialog(null);
        toast({ title: "Folder deleted", tone: "success" });
      },
    });
  };

  const requestDeleteLabel = (label: LabelDTO) => {
    setConfirmDialog({
      title: `Delete “${label.name}”?`,
      description: "The label is removed from every conversation. Messages are not deleted.",
      label: "Delete label",
      tone: "danger",
      icon: <Trash2 className="h-5 w-5" />,
      details: [{ label: "Label", value: label.name }],
      onConfirm: async () => {
        await apiFetch(`/api/v1/labels/${label.id}`, { method: "DELETE" });
        if (activeLabelId === label.id) navigateToFolder("INBOX");
        await loadMeta();
        setConfirmDialog(null);
        toast({ title: "Label deleted", tone: "success" });
      },
    });
  };

  const requestLogout = () => {
    setConfirmDialog({
      title: "Sign out of NyxMail?",
      description:
        "Your encryption keys are removed from this browser session. You can unlock again with your password.",
      label: "Sign out",
      tone: "danger",
      icon: <LogOut className="h-5 w-5" />,
      onConfirm: async () => {
        await logout();
        setConfirmDialog(null);
      },
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "Escape") {
        if (commandOpen) setCommandOpen(false);
        else if (shortcutsOpen) setShortcutsOpen(false);
        else if (contactsOpen) setContactsOpen(false);
        else if (selectedThreadId && mobileReader) updateThreadParam(null);
        return;
      }
      if (commandOpen) return;
      if (editable || event.metaKey || event.ctrlKey || event.altKey) return;
      if (compose || contactsOpen || shortcutsOpen || createDialog || confirmDialog) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key === "c") {
        event.preventDefault();
        openCompose({ mode: "new" });
        return;
      }
      if (event.key === "g") {
        gPressed.current = Date.now();
        return;
      }
      if (event.key === "i" && Date.now() - gPressed.current < 1000) {
        event.preventDefault();
        navigateToFolder("INBOX");
        return;
      }
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        if (threads.length === 0) return;
        const currentIndex = threads.findIndex((thread) => thread.id === selectedThreadId);
        const nextIndex =
          event.key === "j"
            ? Math.min(threads.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
        updateThreadParam(threads[nextIndex]?.id ?? threads[0].id);
        return;
      }
      const currentThread = threads.find((thread) => thread.id === selectedThreadId);
      if (!currentThread && selected.size === 0) return;
      if (event.key === "#") {
        event.preventDefault();
        if (selected.size > 0) requestBulkAction("trash");
        else if (currentThread) requestThreadRemove(currentThread.id, previews[currentThread.id]?.subject);
      } else if (event.key === "e") {
        event.preventDefault();
        if (selected.size > 0) requestBulkAction("archive");
        else if (currentThread) void runThreadAction(currentThread.id, "archive");
      } else if (!currentThread) {
        return;
      } else if (event.key === "u") {
        event.preventDefault();
        void runThreadAction(currentThread.id, currentThread.latest.isRead ? "unread" : "read");
      } else if (event.key === "s") {
        event.preventDefault();
        void runThreadAction(currentThread.id, currentThread.latest.isStarred ? "unstar" : "star");
      } else if (event.key === "r" || event.key === "a" || event.key === "f") {
        const latestMessage = threadMessages[threadMessages.length - 1];
        if (!latestMessage) return;
        event.preventDefault();
        if (event.key === "r") openCompose({ mode: "reply", source: latestMessage, threadId: currentThread.id });
        if (event.key === "a") openCompose({ mode: "replyAll", source: latestMessage, threadId: currentThread.id });
        if (event.key === "f") openCompose({ mode: "forward", source: latestMessage, threadId: null });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    threads,
    selectedThreadId,
    selected,
    previews,
    threadMessages,
    compose,
    contactsOpen,
    shortcutsOpen,
    commandOpen,
    createDialog,
    confirmDialog,
    mobileReader,
  ]);

  const commandItems: CommandItem[] = [
    {
      id: "compose",
      title: "Compose a new message",
      subtitle: "Seal a message to a recipient",
      section: "Actions",
      icon: <Pencil className="h-3.5 w-3.5" />,
      shortcut: "C",
      keywords: "write new send author",
      onRun: () => openCompose({ mode: "new" }),
    },
    {
      id: "mark-all-read",
      title: "Mark all conversations as read",
      subtitle: "Clear the unread badge in this view",
      section: "Actions",
      icon: <CheckCheck className="h-3.5 w-3.5" />,
      keywords: "unread read clear badge",
      onRun: () => void markAllRead(),
    },
    {
      id: "refresh",
      title: "Refresh conversations",
      subtitle: "Check the server for new encrypted mail",
      section: "Actions",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      keywords: "reload sync",
      onRun: () => setRefreshKey((key) => key + 1),
    },
    {
      id: "theme",
      title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      subtitle: "Change the interface theme",
      section: "Actions",
      icon: theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />,
      keywords: "appearance dark light theme",
      onRun: toggleTheme,
    },
    {
      id: "contacts",
      title: "Open contacts",
      subtitle: "Browse your encrypted address book",
      section: "Actions",
      icon: <Users className="h-3.5 w-3.5" />,
      keywords: "people address book",
      onRun: () => setContactsOpen(true),
    },
    {
      id: "shortcuts",
      title: "Keyboard shortcuts",
      subtitle: "Learn the fast path around NyxMail",
      section: "Actions",
      icon: <Keyboard className="h-3.5 w-3.5" />,
      shortcut: "?",
      keywords: "keys help",
      onRun: () => setShortcutsOpen(true),
    },
    {
      id: "settings",
      title: "Open settings",
      subtitle: "Account, security, filters and keys",
      section: "Actions",
      icon: <Settings className="h-3.5 w-3.5" />,
      keywords: "preferences configuration",
      onRun: () => router.push("/settings"),
    },
    {
      id: "logout",
      title: "Sign out of NyxMail",
      subtitle: "Remove your keys from this browser session",
      section: "Actions",
      icon: <LogOut className="h-3.5 w-3.5" />,
      keywords: "lock exit leave",
      onRun: requestLogout,
    },
    ...(selectedThreadId
      ? [
          {
            id: "reply",
            title: "Reply to this conversation",
            section: "Conversation",
            icon: <Mail className="h-3.5 w-3.5" />,
            shortcut: "R",
            keywords: "respond answer",
            onRun: () => replyToCurrent("reply"),
          },
          {
            id: "reply-all",
            title: "Reply all",
            section: "Conversation",
            icon: <Users className="h-3.5 w-3.5" />,
            shortcut: "A",
            keywords: "respond everyone",
            onRun: () => replyToCurrent("replyAll"),
          },
          {
            id: "forward",
            title: "Forward this conversation",
            section: "Conversation",
            icon: <Send className="h-3.5 w-3.5" />,
            shortcut: "F",
            keywords: "share send",
            onRun: () => replyToCurrent("forward"),
          },
        ]
      : []),
    {
      id: "inbox",
      title: "Go to Inbox",
      section: "Navigate",
      icon: <Inbox className="h-3.5 w-3.5" />,
      shortcut: "G I",
      keywords: "mail home",
      onRun: () => navigateToFolder("INBOX"),
    },
    {
      id: "starred",
      title: "Go to Starred",
      section: "Navigate",
      icon: <Star className="h-3.5 w-3.5" />,
      keywords: "favorites",
      onRun: () => navigateToFolder("STARRED"),
    },
    {
      id: "sent",
      title: "Go to Sent",
      section: "Navigate",
      icon: <Send className="h-3.5 w-3.5" />,
      keywords: "outbox delivered",
      onRun: () => navigateToFolder("SENT"),
    },
    {
      id: "drafts",
      title: "Go to Drafts",
      section: "Navigate",
      icon: <FileText className="h-3.5 w-3.5" />,
      keywords: "unsent",
      onRun: () => navigateToFolder("DRAFTS"),
    },
    {
      id: "archive",
      title: "Go to Archive",
      section: "Navigate",
      icon: <Archive className="h-3.5 w-3.5" />,
      keywords: "stored",
      onRun: () => navigateToFolder("ARCHIVE"),
    },
    {
      id: "spam",
      title: "Go to Spam",
      section: "Navigate",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      keywords: "junk filtered",
      onRun: () => navigateToFolder("SPAM"),
    },
    {
      id: "trash",
      title: "Go to Trash",
      section: "Navigate",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      keywords: "deleted bin",
      onRun: () => navigateToFolder("TRASH"),
    },
    {
      id: "all-mail",
      title: "Go to All mail",
      section: "Navigate",
      icon: <Mail className="h-3.5 w-3.5" />,
      keywords: "everything",
      onRun: () => navigateToFolder("ALL"),
    },
    ...labels.map((label) => ({
      id: `label-${label.id}`,
      title: `Open label · ${label.name}`,
      section: "Labels",
      icon: <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />,
      keywords: `${label.name} tag`,
      onRun: () => selectLabel(label.id),
    })),
    ...threads.slice(0, 8).map((thread) => {
      const preview = previews[thread.id];
      return {
        id: `thread-${thread.id}`,
        title: preview?.subject ?? "Encrypted conversation",
        subtitle: `${thread.latest.fromName || thread.latest.fromAddress} · ${preview?.snippet ?? "Decrypting preview…"}`,
        section: "Conversations",
        icon: <Sparkles className="h-3.5 w-3.5" />,
        keywords: `${thread.latest.fromAddress} ${preview?.snippet ?? ""}`,
        onRun: () => {
          setMobileReader(true);
          navigateWith({ thread: thread.id });
        },
      };
    }),
  ];

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <Logo />
          <div className="flex items-center gap-2 text-[11px] text-faint">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
            Preparing your encrypted session…
          </div>
        </div>
      </div>
    );
  }
  if (!ready || !bundle) return <UnlockGate />;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas">
      <div className="hidden h-full lg:flex">
        <Sidebar
          folders={folders}
          labels={labels}
          activeFolder={activeLabelId ? "ALL" : activeFolderParam}
          activeLabel={activeLabelId}
          storageUsed={user.storageUsedBytes}
          storageLimit={user.storageLimitBytes}
          allMailCount={unread}
          onCompose={() => openCompose({ mode: "new" })}
          onSelectFolder={navigateToFolder}
          onSelectLabel={selectLabel}
          onCreateFolder={() => {
            setCreateDialog({ kind: "folder" });
            setCreateName("");
          }}
          onCreateLabel={() => {
            setCreateDialog({ kind: "label" });
            setCreateName("");
          }}
          onDeleteFolder={requestDeleteFolder}
          onDeleteLabel={requestDeleteLabel}
          onOpenContacts={() => setContactsOpen(true)}
        />
      </div>

      <AnimatePresence>
        {mobileNav && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/55"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNav(false)}
            />
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative h-full w-[288px]"
            >
              <Sidebar
                folders={folders}
                labels={labels}
                activeFolder={activeLabelId ? "ALL" : activeFolderParam}
                activeLabel={activeLabelId}
                storageUsed={user.storageUsedBytes}
                storageLimit={user.storageLimitBytes}
                allMailCount={unread}
                mobile
                onClose={() => setMobileNav(false)}
                onCompose={() => {
                  setMobileNav(false);
                  openCompose({ mode: "new" });
                }}
                onSelectFolder={navigateToFolder}
                onSelectLabel={selectLabel}
                onCreateFolder={() => {
                  setMobileNav(false);
                  setCreateDialog({ kind: "folder" });
                  setCreateName("");
                }}
                onCreateLabel={() => {
                  setMobileNav(false);
                  setCreateDialog({ kind: "label" });
                  setCreateName("");
                }}
                onDeleteFolder={requestDeleteFolder}
                onDeleteLabel={requestDeleteLabel}
                onOpenContacts={() => {
                  setMobileNav(false);
                  setContactsOpen(true);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col pb-14 lg:pb-0">
        <TopBar
          user={user}
          query={query}
          onQueryChange={setQuery}
          onQueryClear={() => {
            setQuery("");
            setSearchResults(null);
          }}
          onOpenSidebar={() => setMobileNav(true)}
          onOpenContacts={() => setContactsOpen(true)}
          onOpenCommand={() => setCommandOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onLogout={requestLogout}
        />

        <div className="flex min-h-0 flex-1">
          <section
            className={cn(
              "flex min-w-0 flex-col border-r border-border/70 bg-surface lg:w-[440px] xl:w-[520px] 2xl:w-[660px]",
              selectedThreadId ? "hidden lg:flex" : "flex w-full",
            )}
            aria-label="Message list"
          >
            <MailList
              title={title}
              threads={threads}
              previews={previews}
              activeThreadId={selectedThreadId}
              loading={listLoading && threads.length === 0}
              loadingMore={loadingMore}
              selected={selected}
              searchQuery={query}
              searchResults={searchResults}
              searchBuilding={searchBuilding}
              searchProgress={searchProgress}
              hasMore={nextPage !== null}
              folderKind={folderKind}
              unreadOnly={unreadOnly}
              onUnreadOnlyChange={setUnreadFilter}
              onSearchClear={() => {
                setQuery("");
                setSearchResults(null);
              }}
              onRefresh={() => setRefreshKey((key) => key + 1)}
              onOpenSidebar={() => setMobileNav(true)}
              onSelectThread={(threadId) => {
                setMobileReader(true);
                navigateWith({ thread: threadId });
              }}
              onToggleSelect={(threadId) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(threadId)) next.delete(threadId);
                  else next.add(threadId);
                  return next;
                })
              }
              onSelectAll={(threadIds) => setSelected(new Set(threadIds))}
              onClearSelection={() => setSelected(new Set())}
              onToggleStar={(thread) =>
                void runThreadAction(thread.id, thread.latest.isStarred ? "unstar" : "star")
              }
              onThreadAction={(thread, action) => {
                if (action === "trash") {
                  requestThreadRemove(thread.id, previews[thread.id]?.subject);
                } else {
                  void runThreadAction(thread.id, action);
                }
              }}
              onBulkAction={(action) => requestBulkAction(action)}
              onBulkMove={(folderId, folderName) =>
                requestBulkAction("move", folderId, folderName)
              }
              moveTargets={folders}
              onMarkAllRead={() => void markAllRead()}
              onLoadMore={() => {
                if (nextPage && !loadingMore) void loadThreads(nextPage, true);
              }}
              onCategoryChange={handleCategoryChange}
            />
          </section>

          <section
            className={cn(
              "min-w-0 flex-1",
              selectedThreadId ? "flex flex-col" : "hidden lg:flex lg:flex-col",
            )}
            aria-label="Conversation"
          >
            {selectedThreadId ? (
              <ReadingPane
                messages={threadMessages}
                threadId={selectedThreadId}
                user={user}
                bundle={bundle}
                folders={folders}
                labels={labels}
                loading={threadLoading}
                emptyTitle={title}
                emptyDescription={
                  folderKind === "inbox"
                    ? `You have ${categoryInfo.count} conversation${categoryInfo.count === 1 ? "" : "s"} in your ${categoryInfo.label} category`
                    : `You have ${threads.length} conversation${threads.length === 1 ? "" : "s"} in this folder`
                }
                onBack={() => updateThreadParam(null)}
                onReply={(message, mode) => {
                  if (mode === "forward") {
                    openCompose({ mode: "forward", source: message, threadId: null });
                  } else {
                    openCompose({
                      mode,
                      source: message,
                      threadId: message.dto.threadId,
                    });
                  }
                }}
                onThreadAction={(action, options) => {
                  if (action === "trash") {
                    requestThreadRemove(selectedThreadId, threadMessages[0]?.subject);
                    return Promise.resolve();
                  }
                  return runThreadAction(selectedThreadId, action, options);
                }}
                onMessageAction={(messageId, action) => {
                  if (action === "trash") {
                    requestMessageRemove(
                      messageId,
                      threadMessages.find((message) => message.dto.id === messageId)?.subject,
                    );
                    return Promise.resolve();
                  }
                  return runMessageAction(messageId, action);
                }}
                onToggleLabel={toggleLabel}
                onEditDraft={(message) => openCompose({ mode: "draft", source: message, threadId: message.dto.threadId })}
              />
            ) : (
              <ReadingPane
                messages={[]}
                threadId=""
                user={user}
                bundle={bundle}
                folders={folders}
                labels={labels}
                emptyTitle={
                  searchResults !== null
                    ? "Search results"
                    : folderKind === "inbox" && categoryInfo.label !== "Primary"
                      ? categoryInfo.label
                      : title
                }
                emptyDescription={
                  searchResults !== null
                    ? `${searchResults.length} matching conversation${searchResults.length === 1 ? "" : "s"}`
                    : folderKind === "inbox"
                      ? `You have ${categoryInfo.count} conversation${categoryInfo.count === 1 ? "" : "s"} in your ${categoryInfo.label} category`
                      : `You have ${threads.length} conversation${threads.length === 1 ? "" : "s"} in this folder`
                }
                onBack={() => undefined}
                onReply={() => undefined}
                onThreadAction={async () => undefined}
                onMessageAction={async () => undefined}
                onToggleLabel={async () => undefined}
                onEditDraft={() => undefined}
              />
            )}
          </section>

          <AppRail />
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-border bg-surface/95 px-2 backdrop-blur lg:hidden"
        aria-label="Mobile navigation"
      >
        <button
          type="button"
          className={cn("flex flex-col items-center gap-0.5 px-3 py-1 text-[9px]", activeFolderParam === "INBOX" ? "text-mint" : "text-faint")}
          onClick={() => navigateToFolder("INBOX")}
        >
          <Inbox className="h-5 w-5" /> Inbox
        </button>
        <button
          type="button"
          className={cn("flex flex-col items-center gap-0.5 px-3 py-1 text-[9px]", activeFolderParam === "STARRED" ? "text-mint" : "text-faint")}
          onClick={() => navigateToFolder("STARRED")}
        >
          <Star className="h-5 w-5" /> Starred
        </button>
        <button
          type="button"
          className="compose-fab-glow -mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white transition-transform hover:scale-105 active:scale-95"
          onClick={() => openCompose({ mode: "new" })}
          aria-label="Compose message"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-0.5 px-3 py-1 text-[9px] text-faint"
          onClick={() => {
            if (selectedThreadId) updateThreadParam(null);
            window.setTimeout(() => document.getElementById("mail-search")?.focus(), 50);
          }}
        >
          <Search className="h-5 w-5" /> Search
        </button>
        <Link href="/settings" className="flex flex-col items-center gap-0.5 px-3 py-1 text-[9px] text-faint">
          <Settings className="h-5 w-5" /> Settings
        </Link>
      </nav>

      {compose && (
        <ComposeModal
          key={compose.key}
          seed={compose.seed}
          user={user}
          aliases={aliases}
          gmailAccounts={gmailAccounts}
          contacts={contacts}
          bundle={bundle}
          onClose={() => setCompose(null)}
          onSent={() => void onSent()}
        />
      )}

      <ContactsModal
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        onChanged={() => void loadMeta()}
      />
      <ShortcutHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={commandItems}
      />
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title ?? ""}
        description={confirmDialog?.description}
        confirmLabel={confirmDialog?.label}
        tone={confirmDialog?.tone}
        icon={confirmDialog?.icon}
        count={confirmDialog?.count}
        details={confirmDialog?.details}
        onClose={() => setConfirmDialog(null)}
        onConfirm={async () => {
          if (!confirmDialog) return;
          await confirmDialog.onConfirm();
        }}
      />

      <Modal
        open={Boolean(createDialog)}
        onClose={() => setCreateDialog(null)}
        icon={<Plus className="h-4 w-4" />}
        title={`New ${createDialog?.kind === "label" ? "label" : "folder"}`}
        description={
          createDialog?.kind === "label"
            ? "Labels can be applied across folders and conversations."
            : "Custom folders live alongside Inbox, Sent and Archive."
        }
        width="sm"
      >
        <form onSubmit={createItem} className="space-y-4 p-5">
          <Input
            label="Name"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            maxLength={50}
            autoFocus
            required
          />
          {createDialog?.kind === "label" && (
            <div>
              <p className="label">Color</p>
              <div className="flex flex-wrap gap-2">
                {["#6D4AFF", "#8B5CF6", "#0EA5E9", "#14B8A6", "#22C55E", "#F59E0B", "#EF4444", "#EC4899"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Use color ${color}`}
                    onClick={() => setCreateColor(color)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2",
                      createColor === color ? "border-ink" : "border-transparent",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={createBusy} disabled={!createName.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
