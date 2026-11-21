import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { apiFetch } from "./api";
import { useAuth } from "./auth";
import type { AliasDTO, ContactDTO, FolderDTO, GmailAccountDTO, LabelDTO } from "./types";

interface MailDataContextValue {
  folders: FolderDTO[];
  labels: LabelDTO[];
  aliases: AliasDTO[];
  gmailAccounts: GmailAccountDTO[];
  contacts: ContactDTO[];
  unread: number;
  loading: boolean;
  refreshFolders: () => Promise<void>;
  refreshLabels: () => Promise<void>;
  refreshAliases: () => Promise<void>;
  refreshGmailAccounts: () => Promise<void>;
  refreshContacts: (query?: string) => Promise<void>;
  refreshUnread: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const MailDataContext = createContext<MailDataContextValue | null>(null);

export function MailDataProvider({ children }: { children: React.ReactNode }) {
  const { stage } = useAuth();
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [labels, setLabels] = useState<LabelDTO[]>([]);
  const [aliases, setAliases] = useState<AliasDTO[]>([]);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccountDTO[]>([]);
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshFolders = useCallback(async () => {
    const data = await apiFetch<{ folders: FolderDTO[] }>("/api/v1/folders");
    if (mounted.current) setFolders(data.folders);
  }, []);

  const refreshLabels = useCallback(async () => {
    const data = await apiFetch<{ labels: LabelDTO[] }>("/api/v1/labels");
    if (mounted.current) setLabels(data.labels);
  }, []);

  const refreshAliases = useCallback(async () => {
    const data = await apiFetch<{ aliases: AliasDTO[] }>("/api/v1/aliases");
    if (mounted.current) setAliases(data.aliases);
  }, []);

  const refreshGmailAccounts = useCallback(async () => {
    const data = await apiFetch<{ accounts: GmailAccountDTO[] }>(
      `/api/v1/imports/gmail/accounts?refresh=${Date.now()}`,
    );
    if (mounted.current) setGmailAccounts(data.accounts);
  }, []);

  const refreshContacts = useCallback(async (query = "") => {
    const data = await apiFetch<{ contacts: ContactDTO[] }>(
      `/api/v1/contacts?limit=200${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    );
    if (mounted.current) setContacts(data.contacts);
  }, []);

  const refreshUnread = useCallback(async () => {
    const data = await apiFetch<{ unread: number }>("/api/v1/messages/unread-count");
    if (mounted.current) setUnread(data.unread);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([
      refreshFolders(),
      refreshLabels(),
      refreshAliases(),
      refreshGmailAccounts(),
      refreshUnread(),
      refreshContacts(),
    ]);
    if (mounted.current) setLoading(false);
  }, [
    refreshAliases,
    refreshContacts,
    refreshFolders,
    refreshGmailAccounts,
    refreshLabels,
    refreshUnread,
  ]);

  useEffect(() => {
    if (stage !== "signedIn") return;
    void refreshAll();
    const interval = setInterval(() => {
      refreshUnread().catch(() => undefined);
    }, 45_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshUnread().catch(() => undefined);
        refreshGmailAccounts().catch(() => undefined);
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshAll, refreshGmailAccounts, refreshUnread, stage]);

  const value = useMemo(
    () => ({
      folders,
      labels,
      aliases,
      gmailAccounts,
      contacts,
      unread,
      loading,
      refreshFolders,
      refreshLabels,
      refreshAliases,
      refreshGmailAccounts,
      refreshContacts,
      refreshUnread,
      refreshAll,
    }),
    [
      folders,
      labels,
      aliases,
      gmailAccounts,
      contacts,
      unread,
      loading,
      refreshFolders,
      refreshLabels,
      refreshAliases,
      refreshGmailAccounts,
      refreshContacts,
      refreshUnread,
      refreshAll,
    ],
  );

  return <MailDataContext.Provider value={value}>{children}</MailDataContext.Provider>;
}

export function useMailData(): MailDataContextValue {
  const context = useContext(MailDataContext);
  if (!context) throw new Error("useMailData must be used inside MailDataProvider");
  return context;
}

export function unreadForFolder(folders: FolderDTO[], type: string): number {
  return folders.find((folder) => folder.type === type)?.unreadCount ?? 0;
}
