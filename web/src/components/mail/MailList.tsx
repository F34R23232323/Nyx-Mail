"use client";

import { useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  CheckSquare,
  CreditCard,
  Filter,
  FolderInput,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Megaphone,
  MoreHorizontal,
  Newspaper,
  Paperclip,
  Plane,
  ReceiptText,
  RefreshCw,
  Rows3,
  ShieldCheck,
  Star,
  Trash2,
  Truck,
  Users,
  X,
} from "lucide-react";
import {
  AUTO_FILTERS,
  classifyMessage,
  type AutoFilterId,
  type FolderDTO,
  type FolderType,
  type MessageCategory,
  type ThreadDTO,
} from "@nyxmail/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { MailListSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "./EmptyState";
import { cn, formatListDate, truncate } from "@/lib/client/utils";
import type { SearchDocument } from "@/lib/client/search";

export interface SubjectPreview {
  subject: string;
  snippet: string;
}

const CATEGORIES: Array<{
  id: MessageCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "PRIMARY", label: "Primary", icon: Inbox },
  { id: "SOCIAL", label: "Social", icon: Users },
  { id: "PROMOTIONS", label: "Promotions", icon: Megaphone },
  { id: "NEWSLETTERS", label: "Newsletters", icon: Newspaper },
  { id: "TRANSACTIONS", label: "Transactions", icon: CreditCard },
  { id: "UPDATES", label: "Updates", icon: Bell },
];

const AUTO_FILTER_ICONS: Record<
  AutoFilterId,
  React.ComponentType<{ className?: string }>
> = {
  BILLING: ReceiptText,
  MARKETING: Megaphone,
  SECURITY: ShieldCheck,
  SHIPPING: Truck,
  TRAVEL: Plane,
  NEWSLETTERS: Newspaper,
  SOCIAL: Users,
  NOTIFICATIONS: Bell,
};

interface MailListProps {
  title: string;
  threads: ThreadDTO[];
  previews: Record<string, SubjectPreview>;
  activeThreadId: string | null;
  loading: boolean;
  loadingMore?: boolean;
  selected: Set<string>;
  searchQuery: string;
  searchResults: SearchDocument[] | null;
  searchBuilding: boolean;
  searchProgress: { done: number; total: number } | null;
  hasMore: boolean;
  folderKind: "inbox" | "folder" | "search" | "starred" | "trash";
  unreadOnly: boolean;
  onUnreadOnlyChange: (value: boolean) => void;
  onSearchClear: () => void;
  onRefresh: () => void;
  onOpenSidebar?: () => void;
  onSelectThread: (threadId: string) => void;
  onToggleSelect: (threadId: string) => void;
  onSelectAll: (threadIds: string[]) => void;
  onClearSelection: () => void;
  onToggleStar: (thread: ThreadDTO) => void;
  onThreadAction: (thread: ThreadDTO, action: "read" | "unread" | "archive" | "trash") => void;
  onBulkAction: (action: "read" | "unread" | "archive" | "trash" | "star" | "unstar") => void;
  onBulkMove: (folderId: string, folderName: string) => void;
  moveTargets: FolderDTO[];
  onMarkAllRead: () => void;
  onLoadMore: () => void;
  onCategoryChange: (label: string, count: number) => void;
}

function folderLabel(folderType?: FolderType): string {
  switch (folderType) {
    case "SENT":
      return "Sent";
    case "DRAFTS":
      return "Drafts";
    case "ARCHIVE":
      return "Archive";
    case "SPAM":
      return "Spam";
    case "TRASH":
      return "Trash";
    default:
      return "Inbox";
  }
}

function classificationFor(thread: ThreadDTO, preview?: SubjectPreview): {
  category: MessageCategory;
  categories: AutoFilterId[];
} {
  // New messages carry the classification computed during ingest. Older
  // messages only exist as ciphertext, so fall back to the decrypted preview.
  if (thread.latest.categories?.length) {
    return {
      category: thread.latest.category ?? "PRIMARY",
      categories: thread.latest.categories,
    };
  }
  return classifyMessage({
    fromAddress: thread.latest.fromAddress,
    fromName: thread.latest.fromName,
    subject: preview?.subject,
    text: preview?.snippet,
  });
}

export function MailList({
  title,
  threads,
  previews,
  activeThreadId,
  loading,
  loadingMore,
  selected,
  searchQuery,
  searchResults,
  searchBuilding,
  searchProgress,
  hasMore,
  folderKind,
  unreadOnly,
  onUnreadOnlyChange,
  onSearchClear,
  onRefresh,
  onOpenSidebar,
  onSelectThread,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onToggleStar,
  onThreadAction,
  onBulkAction,
  onBulkMove,
  moveTargets,
  onMarkAllRead,
  onLoadMore,
  onCategoryChange,
}: MailListProps) {
  const [category, setCategory] = useState<MessageCategory>("PRIMARY");
  const [autoFilter, setAutoFilter] = useState<AutoFilterId | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    setCompact(window.localStorage.getItem("nyxmail-density") === "compact");
  }, []);

  const toggleCompact = () => {
    setCompact((value) => {
      const next = !value;
      window.localStorage.setItem("nyxmail-density", next ? "compact" : "comfortable");
      return next;
    });
  };

  const searching = searchResults !== null || searchQuery.trim().length >= 2;

  useEffect(() => {
    setCategory("PRIMARY");
    setAutoFilter(null);
    setStarredOnly(false);
    setAttachmentsOnly(false);
  }, [title, folderKind]);

  const classifications = useMemo(() => {
    const map = new Map<string, ReturnType<typeof classificationFor>>();
    for (const thread of threads) {
      map.set(thread.id, classificationFor(thread, previews[thread.id]));
    }
    return map;
  }, [threads, previews]);

  const categoryCounts = CATEGORIES.reduce<Record<MessageCategory, number>>(
    (counts, item) => {
      counts[item.id] = threads.filter(
        (thread) => classifications.get(thread.id)?.category === item.id,
      ).length;
      return counts;
    },
    {
      PRIMARY: 0,
      SOCIAL: 0,
      PROMOTIONS: 0,
      NEWSLETTERS: 0,
      TRANSACTIONS: 0,
      UPDATES: 0,
    },
  );

  const filterCounts = AUTO_FILTERS.reduce<Record<AutoFilterId, number>>(
    (counts, item) => {
      counts[item.id] = threads.filter((thread) =>
        classifications.get(thread.id)?.categories.includes(item.id),
      ).length;
      return counts;
    },
    {
      BILLING: 0,
      MARKETING: 0,
      SECURITY: 0,
      SHIPPING: 0,
      TRAVEL: 0,
      NEWSLETTERS: 0,
      SOCIAL: 0,
      NOTIFICATIONS: 0,
    },
  );

  const visibleThreads = threads.filter((thread) => {
    const classification = classifications.get(thread.id);
    if (autoFilter) {
      if (!classification?.categories.includes(autoFilter)) return false;
    } else if (!unreadOnly && folderKind === "inbox" && classification?.category !== category) {
      // The unread filter spans every category so the list always matches the
      // unread badge, which also counts across categories.
      return false;
    }
    if (unreadOnly && thread.unreadCount === 0 && thread.latest.isRead) return false;
    if (starredOnly && !thread.latest.isStarred) return false;
    if (attachmentsOnly && thread.latest.attachments.length === 0) return false;
    return true;
  });

  const selectableIds = searchResults
    ? searchResults.map((result) => result.threadId)
    : visibleThreads.map((thread) => thread.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const filtersActive = unreadOnly || starredOnly || attachmentsOnly || Boolean(autoFilter);
  const activeIndex = visibleThreads.findIndex((thread) => thread.id === activeThreadId);
  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex >= 0 && activeIndex < visibleThreads.length - 1;

  const activeCategory = CATEGORIES.find((item) => item.id === category)!;
  const activeCategoryCount = categoryCounts[category];
  const activeAutoFilter = autoFilter
    ? AUTO_FILTERS.find((item) => item.id === autoFilter) ?? null
    : null;
  const activeFilterLabel = activeAutoFilter?.label;
  const visibleCount = visibleThreads.length;

  useEffect(() => {
    if (unreadOnly) onCategoryChange("Unread", visibleCount);
    else if (activeFilterLabel) onCategoryChange(activeFilterLabel, visibleCount);
    else onCategoryChange(activeCategory.label, activeCategoryCount);
  }, [
    unreadOnly,
    activeFilterLabel,
    visibleCount,
    activeCategory.label,
    activeCategoryCount,
    onCategoryChange,
  ]);

  const categoryEmptyCopy = unreadOnly
    ? { title: "Unread", description: "You have no unread conversations in this view." }
    : activeAutoFilter
      ? {
          title: activeAutoFilter.label,
          description: `No ${activeAutoFilter.label.toLowerCase()} conversations in this view yet.`,
        }
      : category === "PRIMARY"
        ? { title: title, description: "You have no conversations in this category yet." }
        : {
            title: activeCategory.label,
            description: `No conversations in ${activeCategory.label.toLowerCase()} yet.`,
          };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border/60 px-3 sm:px-4">
        {onOpenSidebar && (
          <button type="button" className="icon-btn -ml-1 h-8 w-8 lg:hidden" onClick={onOpenSidebar} aria-label="Open navigation">
            <span className="flex flex-col gap-1">
              <span className="h-0.5 w-4 rounded bg-current" />
              <span className="h-0.5 w-4 rounded bg-current" />
              <span className="h-0.5 w-4 rounded bg-current" />
            </span>
          </button>
        )}
        <button
          type="button"
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border border-muted/60 text-transparent transition-colors hover:border-muted"
          data-selected={allSelected}
          onClick={allSelected ? onClearSelection : () => onSelectAll(selectableIds)}
          aria-label={allSelected ? "Clear selection" : "Select all conversations"}
          style={allSelected ? { backgroundColor: "rgb(var(--accent))", borderColor: "rgb(var(--accent))" } : undefined}
        >
          <Check className="h-3 w-3 text-white" />
        </button>
        <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{searching ? "Search results" : title}</h1>
        <Dropdown
          align="start"
          width={232}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              className="icon-btn h-7 w-7"
              onClick={toggle}
              aria-label="Conversation list options"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
          sections={[
            {
              heading: "Conversation list",
              items: [
                {
                  key: "refresh",
                  label: "Refresh",
                  icon: <RefreshCw className="h-3.5 w-3.5" />,
                  onSelect: onRefresh,
                },
                {
                  key: "select-all",
                  label: allSelected ? "Clear selection" : "Select all",
                  icon: <CheckSquare className="h-3.5 w-3.5" />,
                  onSelect: () =>
                    allSelected ? onClearSelection() : onSelectAll(selectableIds),
                },
                {
                  key: "mark-read",
                  label: "Mark all as read",
                  icon: <CheckCheck className="h-3.5 w-3.5" />,
                  onSelect: onMarkAllRead,
                },
                {
                  key: "compact",
                  label: "Compact density",
                  hint: "Fit more conversations on screen",
                  icon: <Rows3 className="h-3.5 w-3.5" />,
                  checked: compact,
                  onSelect: toggleCompact,
                },
              ],
            },
          ]}
        />

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className={cn(
              "hidden h-7 rounded-md px-2 text-[11.5px] font-medium transition-colors sm:block",
              unreadOnly ? "bg-raised text-ink" : "text-muted hover:bg-raised/60 hover:text-ink",
            )}
            aria-pressed={unreadOnly}
          >
            Unread
          </button>
          <Dropdown
            align="end"
            width={236}
            header="Filter this view"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg border px-2 text-[11.5px] font-medium transition-all",
                  filtersActive
                    ? "border-accent/50 bg-accent/10 text-ink shadow-[0_0_0_3px_rgb(var(--accent)/0.07)]"
                    : "border-border/80 text-muted hover:bg-raised/60 hover:text-ink",
                )}
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <Filter className={cn("h-3.5 w-3.5", filtersActive && "text-accent2")} />
                Filter
                {filtersActive && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                    {[unreadOnly, starredOnly, attachmentsOnly, Boolean(autoFilter)].filter(Boolean).length}
                  </span>
                )}
              </button>
            )}
            sections={[
              {
                items: [
                  {
                    key: "unread",
                    label: "Unread only",
                    icon: <Mail className="h-3.5 w-3.5" />,
                    checked: unreadOnly,
                    onSelect: () => onUnreadOnlyChange(!unreadOnly),
                  },
                  {
                    key: "starred",
                    label: "Starred only",
                    icon: <Star className="h-3.5 w-3.5" />,
                    checked: starredOnly,
                    onSelect: () => setStarredOnly((value) => !value),
                  },
                  {
                    key: "attachments",
                    label: "Has attachment",
                    icon: <Paperclip className="h-3.5 w-3.5" />,
                    checked: attachmentsOnly,
                    onSelect: () => setAttachmentsOnly((value) => !value),
                  },
                ],
              },
              ...(filtersActive
                ? [
                    {
                      items: [
                        {
                          key: "clear",
                          label: "Clear all filters",
                          icon: <X className="h-3.5 w-3.5" />,
                          danger: true,
                          onSelect: () => {
                            setAutoFilter(null);
                            onUnreadOnlyChange(false);
                            setStarredOnly(false);
                            setAttachmentsOnly(false);
                          },
                        },
                      ],
                    },
                  ]
                : []),
            ]}
          />
          <span className="mx-1 h-4 w-px bg-border/70" />
          <button
            type="button"
            className="icon-btn h-7 w-7"
            disabled={!canGoBack}
            onClick={() => canGoBack && onSelectThread(visibleThreads[activeIndex - 1].id)}
            aria-label="Previous message"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="icon-btn h-7 w-7"
            disabled={!canGoForward}
            onClick={() => canGoForward && onSelectThread(visibleThreads[activeIndex + 1].id)}
            aria-label="Next message"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!searching && folderKind === "inbox" && !unreadOnly && (
        <div className="no-scrollbar flex h-[46px] shrink-0 items-end overflow-x-auto border-b border-border/60 px-1.5 sm:px-2">
          {CATEGORIES.map((item) => {
            const Icon = item.icon;
            const isActive = category === item.id;
            const count = categoryCounts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={cn(
                  "relative flex h-[45px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-[12px] font-medium transition-colors 2xl:flex-1 2xl:px-1.5",
                  isActive ? "text-ink" : "text-muted hover:text-ink",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={cn("h-[14px] w-[14px] shrink-0", isActive ? "text-ink" : "text-faint")} />
                <span>{item.label}</span>
                {item.id === "UPDATES" && count > 0 && (
                  <span className="ml-0.5 rounded bg-raised px-1.5 py-px text-[9px] font-semibold text-muted">{count}</span>
                )}
                {isActive && (
                  <motion.span
                    layoutId="category-tab"
                    className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-gradient-to-r from-accent to-brand"
                    transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.7 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {!searching && (
        <div className="no-scrollbar flex h-[38px] shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/60 px-2.5">
          <span className="mr-0.5 shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">
            Auto
          </span>
          {AUTO_FILTERS.map((item) => {
            const Icon = AUTO_FILTER_ICONS[item.id];
            const isActive = autoFilter === item.id;
            const count = filterCounts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAutoFilter(isActive ? null : item.id)}
                className={cn(
                  "flex h-[25px] shrink-0 items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium transition-colors",
                  isActive
                    ? "border-accent/50 bg-accent/10 text-ink"
                    : "border-border/70 text-muted hover:bg-raised/60 hover:text-ink",
                )}
                aria-pressed={isActive}
                title={item.description}
              >
                <Icon className={cn("h-3 w-3", isActive ? "text-accent2" : "text-faint")} />
                <span>{item.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "rounded px-1 py-px text-[9px] tabular-nums",
                      isActive ? "bg-accent/15 text-ink" : "bg-raised text-faint",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {autoFilter && (
            <button
              type="button"
              onClick={() => setAutoFilter(null)}
              className="ml-0.5 flex h-[25px] shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium text-muted hover:bg-raised hover:text-ink"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="relative z-30 flex shrink-0 items-center gap-1 border-b border-accent/20 bg-gradient-to-r from-accent/[0.10] via-accent/[0.06] to-brand/[0.06] px-3 py-1.5"
          >
            <motion.span
              key={selected.size}
              initial={{ scale: 0.7, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mr-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white"
            >
              {selected.size}
            </motion.span>
            <span className="mr-1 hidden text-[11px] font-medium text-ink sm:inline">selected</span>
            <button type="button" className="icon-btn h-7 w-7" title="Mark read" onClick={() => onBulkAction("read")}>
              <MailOpen className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="icon-btn h-7 w-7" title="Mark unread" onClick={() => onBulkAction("unread")}>
              <Mail className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="icon-btn h-7 w-7" title="Star" onClick={() => onBulkAction("star")}>
              <Star className="h-3.5 w-3.5" />
            </button>
            <Dropdown
              align="start"
              width={210}
              header="Move selected"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  title="Move to folder"
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                </button>
              )}
              sections={[
                {
                  items: moveTargets
                    .filter(
                      (folder) =>
                        folder.type === "CUSTOM" ||
                        folder.type === "ARCHIVE" ||
                        folder.type === "INBOX",
                    )
                    .map((folder) => ({
                      key: folder.id,
                      label: folder.name,
                      icon: <FolderInput className="h-3.5 w-3.5" />,
                      onSelect: () => onBulkMove(folder.id, folder.name),
                    })),
                },
              ]}
            />
            <button type="button" className="icon-btn h-7 w-7" title="Archive" onClick={() => onBulkAction("archive")}>
              <Archive className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="icon-btn h-7 w-7 text-danger/80 hover:text-danger"
              title="Delete"
              onClick={() => onBulkAction("trash")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="icon-btn ml-auto h-7 w-7" title="Clear selection" onClick={onClearSelection}>
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        {loading ? (
          <MailListSkeleton />
        ) : searchBuilding ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent2" />
            <p className="text-sm font-medium text-ink">
              {searchProgress ? "Building your private search index" : "Searching your local index"}
            </p>
            <p className="max-w-xs text-[11px] leading-relaxed text-muted">
              Messages are decrypted and indexed in this browser. The server never sees the index.
            </p>
            {searchProgress && (
              <div className="mt-2 w-44">
                <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.max(4, (searchProgress.done / Math.max(1, searchProgress.total)) * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-faint">
                  {searchProgress.done} / {searchProgress.total}
                </p>
              </div>
            )}
          </div>
        ) : searchResults ? (
          searchResults.length === 0 ? (
            <EmptyState
              kind="search"
              action={
                <button type="button" onClick={onSearchClear} className="btn btn-secondary btn-sm mt-5">
                  Clear search
                </button>
              }
            />
          ) : (
            <Virtuoso
              style={{ height: "100%" }}
              data={searchResults}
              itemContent={(_index, item) => (
                <button
                  type="button"
                  className="mail-row block w-full"
                  data-active={item.threadId === activeThreadId}
                  data-compact={compact}
                  onClick={() => onSelectThread(item.threadId)}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={item.fromName} email={item.from} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-semibold text-ink">{item.fromName || item.from}</p>
                        <span className="rounded bg-raised px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-muted">
                          {folderLabel(item.folderType)}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted">
                          {formatListDate(new Date(item.date).toISOString())}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-ink/90">{item.subject}</p>
                      <p className="mail-row-snippet mt-0.5 line-clamp-1 text-[12px] leading-relaxed text-muted">
                        {truncate(item.body, 180)}
                      </p>
                    </div>
                  </div>
                </button>
              )}
            />
          )
        ) : visibleThreads.length === 0 ? (
          <EmptyState
            kind={folderKind}
            title={categoryEmptyCopy.title}
            description={
              filtersActive
                ? activeAutoFilter
                  ? `No ${activeAutoFilter.label.toLowerCase()} conversations match the selected filters in this view.`
                  : "No conversations match the selected filters."
                : categoryEmptyCopy.description
            }
          />
        ) : (
          <Virtuoso
            style={{ height: "100%" }}
            data={visibleThreads}
            endReached={onLoadMore}
            itemContent={(_index, thread) => {
              const preview = previews[thread.id];
              const isSelected = selected.has(thread.id);
              const latest = thread.latest;
              const threadLabels = thread.labels.length > 0 ? thread.labels : latest.labels;
              return (
                <div
                  className="mail-row group"
                  data-active={thread.id === activeThreadId}
                  data-compact={compact}
                  onClick={() => onSelectThread(thread.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectThread(thread.id);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0 pt-0.5">
                      <button
                        type="button"
                        className={cn(
                          "absolute -left-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border bg-surface transition-opacity",
                          isSelected ? "border-accent bg-accent opacity-100" : "border-muted/60 opacity-0 group-hover:opacity-100",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleSelect(thread.id);
                        }}
                        aria-label={isSelected ? "Deselect conversation" : "Select conversation"}
                      >
                        {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                      </button>
                      <Avatar
                        name={latest.fromName}
                        email={latest.fromAddress}
                        size="sm"
                        className={cn(
                          "text-[10px] transition-shadow",
                          !latest.isRead && "ring-2 ring-accent/30 ring-offset-2 ring-offset-surface",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p
                          className={cn(
                            "truncate text-[13px]",
                            latest.isRead ? "font-medium text-ink/85" : "font-semibold text-ink",
                          )}
                        >
                          {latest.fromName || latest.fromAddress}
                        </p>
                        {threadLabels.slice(0, 2).map((label) => (
                          <span
                            key={label.id}
                            className="hidden shrink-0 text-[10px] font-semibold sm:inline"
                            style={{ color: label.color }}
                          >
                            {label.name}
                          </span>
                        ))}
                        {thread.messageCount > 1 && (
                          <span className="shrink-0 text-[10px] font-normal text-faint">{thread.messageCount}</span>
                        )}
                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[11px] tabular-nums group-hover:hidden",
                              latest.isRead ? "text-muted" : "font-medium text-ink/80",
                            )}
                          >
                            {formatListDate(latest.sentAt)}
                          </span>
                          <div className="hidden items-center gap-0.5 group-hover:flex">
                            <button
                              type="button"
                              className="icon-btn h-6 w-6"
                              title={latest.isRead ? "Mark unread" : "Mark read"}
                              onClick={(event) => {
                                event.stopPropagation();
                                onThreadAction(thread, latest.isRead ? "unread" : "read");
                              }}
                            >
                              {latest.isRead ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              className="icon-btn h-6 w-6"
                              title="Archive"
                              onClick={(event) => {
                                event.stopPropagation();
                                onThreadAction(thread, "archive");
                              }}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="icon-btn h-6 w-6"
                              title="Delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                onThreadAction(thread, "trash");
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={cn("icon-btn h-6 w-6 transition-colors", latest.isStarred && "text-warning")}
                              title={latest.isStarred ? "Unstar" : "Star"}
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleStar(thread);
                              }}
                            >
                              <motion.span
                                key={String(latest.isStarred)}
                                initial={{ scale: 0.55, rotate: -22 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: "spring", stiffness: 520, damping: 17 }}
                                className="inline-flex"
                              >
                                <Star className="h-3.5 w-3.5" fill={latest.isStarred ? "currentColor" : "none"} />
                              </motion.span>
                            </button>
                          </div>
                        </div>
                      </div>
                      <p
                        className={cn(
                          "mt-0.5 truncate text-[13px]",
                          latest.isRead ? "text-ink/75" : "font-semibold text-ink",
                        )}
                      >
                        {preview?.subject ?? "Encrypted message"}
                      </p>
                      <p className="mail-row-snippet mt-0.5 line-clamp-1 text-[12px] leading-relaxed text-muted">
                        {preview?.snippet || "Decrypting preview…"}
                      </p>
                      {latest.attachments.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {latest.attachments.slice(0, 2).map((attachment) => (
                            <span
                              key={attachment.id}
                              className="inline-flex max-w-[180px] items-center gap-1 rounded border border-border/80 bg-raised/50 px-1.5 py-0.5 text-[10px] text-muted"
                            >
                              <Paperclip className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{attachment.filename}</span>
                            </span>
                          ))}
                          {latest.attachments.length > 2 && (
                            <span className="text-[10px] text-faint">+{latest.attachments.length - 2}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }}
            components={{
              Footer: () =>
                loadingMore ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-faint" />
                  </div>
                ) : hasMore ? (
                  <div className="h-10" />
                ) : null,
            }}
          />
        )}
      </div>
    </div>
  );
}
