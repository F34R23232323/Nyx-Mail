"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  Inbox,
  Layers,
  LayoutGrid,
  Mail,
  Pencil,
  Plus,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { FolderDTO, LabelDTO } from "@nyxmail/shared";
import { Logo } from "@/components/ui/Logo";
import { avatarColor, cn, formatBytes } from "@/lib/client/utils";

interface SidebarProps {
  folders: FolderDTO[];
  labels: LabelDTO[];
  activeFolder: string;
  activeLabel: string | null;
  storageUsed: number;
  storageLimit: number;
  allMailCount?: number;
  mobile?: boolean;
  onClose?: () => void;
  onCompose: () => void;
  onSelectFolder: (folder: string) => void;
  onSelectLabel: (labelId: string | null) => void;
  onCreateFolder: () => void;
  onCreateLabel: () => void;
  onDeleteFolder: (folder: FolderDTO) => void;
  onDeleteLabel: (label: LabelDTO) => void;
  onOpenContacts: () => void;
}

export function Sidebar({
  folders,
  labels,
  activeFolder,
  activeLabel,
  storageUsed,
  storageLimit,
  allMailCount,
  mobile,
  onClose,
  onCompose,
  onSelectFolder,
  onSelectLabel,
  onCreateFolder,
  onCreateLabel,
  onDeleteFolder,
  onDeleteLabel,
  onOpenContacts,
}: SidebarProps) {
  const [showLess, setShowLess] = useState(true);
  const [showViews, setShowViews] = useState(false);
  const storagePct = storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;

  const customFolders = folders.filter((folder) => folder.type === "CUSTOM");

  const primaryFolders = [
    { key: "INBOX", label: "Inbox", icon: Inbox, active: activeFolder === "INBOX" },
    { key: "DRAFTS", label: "Drafts", icon: FileText, active: activeFolder === "DRAFTS" },
    { key: "SENT", label: "Sent", icon: Send, active: activeFolder === "SENT" },
    { key: "STARRED", label: "Starred", icon: Star, active: activeFolder === "STARRED" },
  ];

  const secondaryFolders = [
    { key: "SPAM", label: "Spam", icon: ShieldAlert, active: activeFolder === "SPAM" },
    { key: "ARCHIVE", label: "Archive", icon: Archive, active: activeFolder === "ARCHIVE" },
    { key: "TRASH", label: "Trash", icon: Trash2, active: activeFolder === "TRASH" },
  ];

  return (
    <aside
      className={cn(
        "flex h-full w-[240px] shrink-0 flex-col border-r border-border/70 bg-canvas",
        mobile && "w-[280px] shadow-soft",
      )}
      aria-label="Mailbox navigation"
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link href="/mail" aria-label="NyxMail inbox">
          <Logo />
        </Link>
        {mobile ? (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" className="icon-btn h-7 w-7" aria-label="App launcher" title="Apps">
            <LayoutGrid className="h-[17px] w-[17px]" />
          </button>
        )}
      </div>

      <div className="px-2 pb-3 pt-1">
        <button
          type="button"
          onClick={onCompose}
          className="btn btn-primary group h-10 w-full justify-center gap-2 rounded-xl px-3 text-[14px] font-semibold"
        >
          <Pencil className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-rotate-12" />
          New message
          <span className="ml-auto hidden rounded-md bg-white/15 px-1.5 py-0.5 text-[9px] font-medium tracking-wide opacity-0 transition-opacity group-hover:opacity-100 2xl:inline">
            C
          </span>
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 no-scrollbar">
        <div className="space-y-px">
          {primaryFolders.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className="nav-item w-full"
                data-active={item.active && !activeLabel}
                onClick={() => onSelectFolder(item.key)}
              >
                <Icon className="h-[17px] w-[17px]" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            className="nav-item w-full"
            data-active={false}
            onClick={() => setShowLess((value) => !value)}
            aria-expanded={showLess}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showLess && "-rotate-90")} />
            Less
          </button>

          {showLess && (
            <>
              {secondaryFolders.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="nav-item w-full"
                    data-active={item.active && !activeLabel}
                    onClick={() => onSelectFolder(item.key)}
                  >
                    <Icon className="h-[17px] w-[17px]" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="nav-item w-full"
                data-active={activeFolder === "ALL" && !activeLabel}
                onClick={() => onSelectFolder("ALL")}
              >
                <Mail className="h-[17px] w-[17px]" />
                <span className="truncate">All mail</span>
                {typeof allMailCount === "number" && allMailCount > 0 && (
                  <span className="ml-auto text-[10px] font-medium tabular-nums text-muted">{allMailCount}</span>
                )}
              </button>
            </>
          )}
        </div>

        <div className="my-2.5 h-px bg-border/60" />

        <div className="space-y-px">
          <button
            type="button"
            className="nav-item w-full"
            onClick={() => setShowViews((value) => !value)}
            aria-expanded={showViews}
          >
            <Layers className="h-[17px] w-[17px]" />
            <span>Views</span>
            <ChevronRight
              className={cn("ml-auto h-3.5 w-3.5 transition-transform", showViews && "rotate-90")}
            />
          </button>
          {showViews && (
            <button type="button" className="nav-item w-full pl-8" onClick={onOpenContacts}>
              <Users className="h-4 w-4" />
              Contacts
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-1 px-2.5 py-1.5">
          <span className="text-[11px] font-semibold text-muted">Folders</span>
          <button
            type="button"
            className="rounded p-0.5 text-faint transition-colors hover:text-ink"
            onClick={onCreateFolder}
            aria-label="Create folder"
            title="Create folder"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <Link
            href="/settings?tab=filters"
            className="ml-auto rounded p-0.5 text-faint transition-colors hover:text-ink"
            aria-label="Folder settings"
            title="Folder settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="space-y-px">
          {customFolders.length === 0 && (
            <p className="px-2.5 py-1 text-[11px] text-faint/80">No custom folders</p>
          )}
          {customFolders.map((folder) => (
            <div key={folder.id} className="group flex items-center">
              <button
                type="button"
                className="nav-item min-w-0 flex-1"
                data-active={activeFolder === folder.id && !activeLabel}
                onClick={() => onSelectFolder(folder.id)}
              >
                <span
                  className="h-[13px] w-[13px] shrink-0 rounded-[3px]"
                  style={{ backgroundColor: avatarColor(folder.name) }}
                />
                <span className="truncate">{folder.name}</span>
              </button>
              <button
                type="button"
                className="hidden rounded p-1 text-faint hover:text-danger group-hover:block"
                onClick={() => onDeleteFolder(folder)}
                aria-label={`Delete ${folder.name} folder`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-1 px-2.5 py-1.5">
          <span className="text-[11px] font-semibold text-muted">Labels</span>
          <button
            type="button"
            className="rounded p-0.5 text-faint transition-colors hover:text-ink"
            onClick={onCreateLabel}
            aria-label="Create label"
            title="Create label"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <Link
            href="/settings?tab=filters"
            className="ml-auto rounded p-0.5 text-faint transition-colors hover:text-ink"
            aria-label="Label settings"
            title="Label settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="space-y-px">
          {labels.length === 0 && <p className="px-2.5 py-1 text-[11px] text-faint/80">No labels yet</p>}
          {labels.map((label) => (
            <div key={label.id} className="group flex items-center">
              <button
                type="button"
                className="nav-item min-w-0 flex-1"
                data-active={activeLabel === label.id}
                onClick={() => onSelectLabel(label.id === activeLabel ? null : label.id)}
              >
                <span
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="truncate">{label.name}</span>
              </button>
              <button
                type="button"
                className="hidden rounded p-1 text-faint hover:text-danger group-hover:block"
                onClick={() => onDeleteLabel(label)}
                aria-label={`Delete ${label.name} label`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </nav>

      <div className="shrink-0 px-4 pb-3 pt-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[9px] text-faint">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-mint/10">
            <ShieldCheck className="h-2.5 w-2.5 text-mint" />
          </span>
          <span>Encrypted on this device</span>
        </div>
        <div className="flex items-center justify-between text-[9.5px] text-faint">
          <span className="tabular-nums">
            {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
          </span>
          <span className={cn("tabular-nums", storagePct > 90 ? "text-danger" : "text-muted")}>
            {Math.round(storagePct)}%
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
          <div
            className={cn(
              "h-full rounded-full bg-gradient-to-r transition-all duration-700",
              storagePct > 90 ? "from-warning to-danger" : "from-accent to-mint",
            )}
            style={{ width: `${Math.max(1, storagePct)}%` }}
          />
        </div>
      </div>
    </aside>
  );
}
