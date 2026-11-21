"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Clock3,
  CornerUpLeft,
  CornerUpRight,
  FilePenLine,
  Forward,
  Inbox,
  MailOpen,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { FolderDTO, LabelDTO, UserDTO } from "@nyxmail/shared";
import { normalizeEmail } from "@nyxmail/shared";
import type { KeyBundle } from "@nyxmail/crypto";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/lib/client/toast";
import { cn, formatBytes, formatFullDate } from "@/lib/client/utils";
import type { DecryptedMail } from "@/lib/client/mail-crypto";
import { SanitizedEmail } from "./SanitizedEmail";
import { AttachmentChip } from "./AttachmentChip";
import { EmptyState } from "./EmptyState";

interface ReadingPaneProps {
  messages: DecryptedMail[];
  threadId: string;
  user: UserDTO;
  bundle: KeyBundle;
  folders: FolderDTO[];
  labels: LabelDTO[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onBack: () => void;
  onReply: (message: DecryptedMail, mode: "reply" | "replyAll" | "forward") => void;
  onThreadAction: (
    action:
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
      | "snooze",
    options?: { folderId?: string; snoozeUntil?: string | null },
  ) => Promise<void>;
  onMessageAction: (messageId: string, action: "read" | "unread" | "star" | "unstar" | "trash") => Promise<void>;
  onToggleLabel: (labelId: string, add: boolean) => Promise<void>;
  onEditDraft: (message: DecryptedMail) => void;
}

function Menu({
  trigger,
  children,
  align = "right",
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((current) => !current)}>{trigger}</div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
            className={cn(
              "absolute top-full z-40 mt-1.5 max-h-[min(72vh,560px)] min-w-52 overflow-y-auto rounded-xl border border-border bg-surface/95 py-1 shadow-soft backdrop-blur-xl",
              align === "right" ? "right-0" : "left-0",
            )}
            role="menu"
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition-colors hover:bg-raised",
        danger ? "text-danger hover:bg-danger/10" : "text-ink",
      )}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function snoozeOptions(): Array<{ label: string; value: string }> {
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(8, 0, 0, 0);
  return [
    { label: "In 1 hour", value: new Date(now + 3600_000).toISOString() },
    { label: "This evening", value: new Date(now + 4 * 3600_000).toISOString() },
    { label: "Tomorrow at 8am", value: tomorrow.toISOString() },
    { label: "Next week", value: nextWeek.toISOString() },
  ];
}

interface SecurityFlag {
  key: string;
  label: string;
  detail: string;
  severity: "danger" | "warning";
}

function securityFlagsFor(message: DecryptedMail): SecurityFlag[] {
  const checks: Array<[string, string | null | undefined]> = [
    ["SPF", message.dto.spf],
    ["DKIM", message.dto.dkim],
    ["DMARC", message.dto.dmarc],
  ];
  const flags: SecurityFlag[] = [];
  for (const [name, raw] of checks) {
    if (!raw) continue;
    const value = raw.toLowerCase();
    if (value === "pass" || value === "none") continue;
    const severity = value === "fail" ? "danger" : "warning";
    const label =
      value === "fail"
        ? `${name} failed`
        : value === "softfail"
          ? `${name} soft fail`
          : `${name} ${value}`;
    flags.push({
      key: `${name}-${value}`,
      label,
      detail: `${name} authentication result: ${value}`,
      severity,
    });
  }
  return flags;
}

function recipientsLabel(message: DecryptedMail): string {
  const to = message.dto.toAddresses.map((a) => a.name || a.email);
  const cc = message.dto.ccAddresses.map((a) => a.name || a.email);
  return `to ${to.slice(0, 3).join(", ")}${to.length > 3 ? ` +${to.length - 3}` : ""}${
    cc.length ? ` · cc ${cc.slice(0, 2).join(", ")}` : ""
  }`;
}

export function ReadingPane({
  messages,
  threadId,
  user,
  bundle,
  folders,
  labels,
  loading,
  emptyTitle,
  emptyDescription,
  onBack,
  onReply,
  onThreadAction,
  onMessageAction,
  onToggleLabel,
  onEditDraft,
}: ReadingPaneProps) {
  const { toast } = useToast();
  const latest = messages[messages.length - 1];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (messages.length === 0) return;
    setExpanded(new Set([messages[messages.length - 1].dto.id]));
  }, [threadId, messages.length]);

  const allStarred = messages.length > 0 && messages.every((message) => message.dto.isStarred);
  const anyUnread = messages.some((message) => !message.dto.isRead);
  const threadLabels = useMemo(() => {
    const map = new Map<string, LabelDTO>();
    for (const message of messages) {
      for (const label of message.dto.labels) map.set(label.id, label);
    }
    return Array.from(map.values());
  }, [messages]);
  const currentFolder = useMemo(() => {
    if (!latest) return null;
    return folders.find((folder) => folder.id === latest.dto.folderId) ?? null;
  }, [folders, latest]);
  const inSpam = currentFolder?.type === "SPAM";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          <p className="text-[11px] text-faint">Decrypting conversation…</p>
        </div>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="h-full pt-8 lg:pt-20">
        <EmptyState
          kind="inbox"
          title={emptyTitle ?? "Select a conversation"}
          description={
            emptyDescription ??
            "Messages are decrypted locally when you open them. The server only stores sealed envelopes."
          }
        />
      </div>
    );
  }

  const runThread = async (
    action: Parameters<ReadingPaneProps["onThreadAction"]>[0],
    options?: Parameters<ReadingPaneProps["onThreadAction"]>[1],
  ) => {
    try {
      await onThreadAction(action, options);
    } catch {
      toast({ title: "Action failed", tone: "error" });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="relative flex h-[52px] shrink-0 items-center gap-1 border-b border-border/60 px-2 sm:px-3">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
        <button type="button" className="icon-btn h-8 w-8 lg:hidden" onClick={onBack} aria-label="Back to message list">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-medium tracking-[-0.01em] text-ink">{latest.subject}</h2>
          <p className="truncate text-[9.5px] text-faint">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={cn("icon-btn h-8 w-8", allStarred && "text-warning")}
            onClick={() => void runThread(allStarred ? "unstar" : "star")}
            aria-label={allStarred ? "Unstar conversation" : "Star conversation"}
          >
            <motion.span
              key={String(allStarred)}
              initial={{ scale: 0.5, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 16 }}
              className="inline-flex"
            >
              <Star className="h-4 w-4" fill={allStarred ? "currentColor" : "none"} />
            </motion.span>
          </button>
          {inSpam && (
            <button
              type="button"
              className="icon-btn h-8 w-8 text-success"
              onClick={() => void runThread("notSpam")}
              aria-label="Mark as not spam"
              title="Not spam — move to Inbox and train the filter"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
          )}
          <button type="button" className="icon-btn h-8 w-8" onClick={() => void runThread("archive")} aria-label="Archive conversation" title="Archive (E)">
            <Archive className="h-4 w-4" />
          </button>
          <button type="button" className="icon-btn h-8 w-8" onClick={() => void runThread("trash")} aria-label="Delete conversation" title="Delete (#)">
            <Trash2 className="h-4 w-4" />
          </button>
          <Menu
            trigger={
              <button type="button" className="icon-btn" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            {(close) => (
              <>
                <MenuItem icon={<MailOpen className="h-3.5 w-3.5" />} onClick={() => { close(); void runThread(anyUnread ? "read" : "unread"); }}>
                  {anyUnread ? "Mark read" : "Mark unread"}
                </MenuItem>
                {inSpam && (
                  <MenuItem icon={<ShieldCheck className="h-3.5 w-3.5 text-success" />} onClick={() => { close(); void runThread("notSpam"); }}>
                    Not spam — train as legitimate
                  </MenuItem>
                )}
                <MenuItem icon={<Inbox className="h-3.5 w-3.5" />} onClick={() => { close(); void runThread(inSpam ? "notSpam" : "inbox"); }}>
                  Move to Inbox
                </MenuItem>
                <MenuItem icon={<ShieldAlert className="h-3.5 w-3.5" />} onClick={() => { close(); void runThread("spam"); }}>
                  Move to Spam
                </MenuItem>
                <div className="my-1 h-px bg-border" />
                <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-faint">Move to folder</p>
                {folders
                  .filter((folder) => folder.type === "CUSTOM" || folder.type === "ARCHIVE")
                  .map((folder) => (
                    <MenuItem key={folder.id} onClick={() => { close(); void runThread("move", { folderId: folder.id }); }}>
                      {folder.name}
                    </MenuItem>
                  ))}
                <div className="my-1 h-px bg-border" />
                <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-faint">Snooze</p>
                {snoozeOptions().map((option) => (
                  <MenuItem icon={<Clock3 className="h-3.5 w-3.5" />} key={option.label} onClick={() => { close(); void runThread("snooze", { snoozeUntil: option.value }); }}>
                    {option.label}
                  </MenuItem>
                ))}
                <div className="my-1 h-px bg-border" />
                <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-faint">Label</p>
                {labels.length === 0 && <p className="px-3 py-1.5 text-[10px] text-faint">No labels yet</p>}
                {labels.map((label) => {
                  const applied = threadLabels.some((item) => item.id === label.id);
                  return (
                    <MenuItem
                      key={label.id}
                      icon={<Tag className="h-3.5 w-3.5" style={{ color: label.color }} />}
                      onClick={() => {
                        close();
                        void onToggleLabel(label.id, !applied);
                      }}
                    >
                      <span className="flex-1">{label.name}</span>
                      {applied && <span className="text-[9px] text-success">applied</span>}
                    </MenuItem>
                  );
                })}
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 sm:px-6">
          {messages.map((message) => {
            const isOpen = expanded.has(message.dto.id);
            const fromMe = normalizeEmail(message.dto.fromAddress) === normalizeEmail(user.email);
            const isDraft = message.dto.isDraft;
            const securityFlags = securityFlagsFor(message);
            return (
              <div
                key={message.dto.id}
                className={cn(
                  "mb-2.5 overflow-hidden rounded-xl border bg-surface transition-colors",
                  isOpen ? "border-border/80" : "border-border/60 hover:border-border",
                )}
              >
                <div
                  className="flex cursor-pointer items-start gap-3 px-4 py-3.5"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(message.dto.id)) next.delete(message.dto.id);
                      else next.add(message.dto.id);
                      return next;
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(message.dto.id)) next.delete(message.dto.id);
                        else next.add(message.dto.id);
                        return next;
                      });
                    }
                  }}
                >
                  <Avatar name={message.dto.fromName} email={message.dto.fromAddress} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <p className="text-[12.5px] font-semibold text-ink">
                        {fromMe ? "You" : message.dto.fromName || message.dto.fromAddress}
                      </p>
                      {fromMe && <span className="text-[10px] text-faint">({message.dto.fromAddress})</span>}
                      {isDraft && (
                        <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-warning">
                          Draft
                        </span>
                      )}
                      {!message.dto.isRead && !isOpen && (
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unread" />
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-faint">
                        {formatFullDate(message.dto.sentAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10.5px] text-faint">{recipientsLabel(message)}</p>
                    {!isOpen && (
                      <p className="mt-1 line-clamp-1 text-[11.5px] text-muted">
                        {message.body.text || message.body.html.replace(/<[^>]+>/g, " ").slice(0, 160)}
                      </p>
                    )}
                    {securityFlags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {securityFlags.map((flag) => (
                          <span
                            key={flag.key}
                            title={flag.detail}
                            className={cn(
                              "chip px-1.5 py-0.5 text-[8px]",
                              flag.severity === "danger"
                                ? "border-danger/20 text-danger"
                                : "border-warning/25 text-warning",
                            )}
                          >
                            <ShieldAlert className="h-2.5 w-2.5" /> {flag.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ml-1 flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      className={cn("icon-btn h-7 w-7", message.dto.isStarred && "text-warning")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onMessageAction(message.dto.id, message.dto.isStarred ? "unstar" : "star");
                      }}
                      aria-label={message.dto.isStarred ? "Unstar message" : "Star message"}
                    >
                      <motion.span
                        key={String(message.dto.isStarred)}
                        initial={{ scale: 0.55, rotate: -22 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 520, damping: 17 }}
                        className="inline-flex"
                      >
                        <Star className="h-3.5 w-3.5" fill={message.dto.isStarred ? "currentColor" : "none"} />
                      </motion.span>
                    </button>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-faint transition-transform", isOpen && "rotate-180")} />
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="message-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        height: { duration: 0.26, ease: [0.16, 1, 0.3, 1] },
                        opacity: { duration: 0.18 },
                      }}
                      className="overflow-hidden border-t border-border/70"
                    >
                    <div className="px-4 pb-5 pt-4 sm:px-5">
                      {isDraft ? (
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/20 bg-warning/[0.05] px-3 py-2.5">
                          <p className="text-[11px] text-muted">This is a draft. It has not been sent.</p>
                          <Button size="sm" onClick={() => onEditDraft(message)} icon={<FilePenLine className="h-3.5 w-3.5" />}>
                            Edit draft
                          </Button>
                        </div>
                      ) : null}
                      <SanitizedEmail html={message.body.html} sender={message.dto.fromAddress} messageId={message.dto.id} />
                      {message.body.attachments.length > 0 && (
                        <div className="mt-5 border-t border-border/60 pt-4">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                            {message.body.attachments.length} encrypted {message.body.attachments.length === 1 ? "attachment" : "attachments"}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {message.body.attachments.map((attachment) => (
                              <AttachmentChip key={attachment.blobId} attachment={attachment} bundle={bundle} />
                            ))}
                          </div>
                        </div>
                      )}
                      {typeof message.dto.spamScore === "number" && (
                        <details className="mt-5 rounded-lg border border-border/70 bg-raised/20 px-3 py-2 text-[11px] text-muted">
                          <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink">Spam analysis</span>
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                                message.dto.spamScore >= 5
                                  ? "bg-danger/10 text-danger"
                                  : "bg-success/10 text-success",
                              )}
                            >
                              score {message.dto.spamScore.toFixed(2)}
                            </span>
                            {message.dto.spamAction && <span className="text-faint">{message.dto.spamAction}</span>}
                            {message.dto.spamEngine && <span className="text-faint">· {message.dto.spamEngine}</span>}
                          </summary>
                          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-border/50 pt-2">
                            {(message.dto.spamSymbols ?? []).length === 0 ? (
                              <p className="text-faint">No symbol details were stored for this message.</p>
                            ) : (
                              (message.dto.spamSymbols ?? []).map((symbol) => (
                                <div key={symbol.name} className="flex items-start justify-between gap-3">
                                  <span className="min-w-0 break-words font-mono text-[10px] text-ink/80">
                                    {symbol.name}
                                    {symbol.options?.length ? (
                                      <span className="ml-1 font-sans text-faint">({symbol.options.join(", ").slice(0, 120)})</span>
                                    ) : null}
                                  </span>
                                  <span
                                    className={cn(
                                      "shrink-0 font-mono text-[10px] tabular-nums",
                                      symbol.score > 0 ? "text-danger" : symbol.score < 0 ? "text-success" : "text-faint",
                                    )}
                                  >
                                    {symbol.score > 0 ? "+" : ""}
                                    {symbol.score.toFixed(2)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </details>
                      )}
                      <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onReply(message, "reply")}
                        >
                          <CornerUpLeft className="h-3.5 w-3.5" /> Reply
                        </button>
                        {message.dto.ccAddresses.length + message.dto.toAddresses.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => onReply(message, "replyAll")}
                          >
                            <CornerUpRight className="h-3.5 w-3.5" /> Reply all
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onReply(message, "forward")}
                        >
                          <Forward className="h-3.5 w-3.5" /> Forward
                        </button>
                        <Menu
                          trigger={
                            <button type="button" className="btn btn-ghost btn-sm" aria-label="Message actions">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          }
                        >
                          {(close) => (
                            <>
                              <MenuItem
                                icon={<MailOpen className="h-3.5 w-3.5" />}
                                onClick={() => {
                                  close();
                                  void onMessageAction(message.dto.id, message.dto.isRead ? "unread" : "read");
                                }}
                              >
                                Mark {message.dto.isRead ? "unread" : "read"}
                              </MenuItem>
                              <MenuItem
                                icon={<Archive className="h-3.5 w-3.5" />}
                                onClick={() => {
                                  close();
                                  void runThread("archive");
                                }}
                              >
                                Archive conversation
                              </MenuItem>
                              <MenuItem
                                danger
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                                onClick={() => {
                                  close();
                                  void onMessageAction(message.dto.id, "trash");
                                }}
                              >
                                Delete message
                              </MenuItem>
                            </>
                          )}
                        </Menu>
                        <div className="ml-auto flex items-center gap-3 text-[9px] text-faint">
                          {message.dto.spf === "pass" && (
                            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-success" /> SPF</span>
                          )}
                          {message.dto.dkim === "pass" && (
                            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-success" /> DKIM</span>
                          )}
                          {message.dto.dmarc === "pass" && (
                            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-success" /> DMARC</span>
                          )}
                          <span>{formatBytes(message.dto.sizeBytes)}</span>
                        </div>
                      </div>
                    </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          <div className="mt-4 flex items-center gap-2 px-1 text-[10px] text-faint">
            <ShieldCheck className="h-3 w-3 text-success" />
            This conversation was decrypted in your browser. {currentFolder ? `Stored in ${currentFolder.name}.` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
