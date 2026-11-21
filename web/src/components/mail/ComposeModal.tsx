"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bold,
  CalendarClock,
  ChevronDown,
  FileText,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  LockKeyhole,
  Paperclip,
  Quote,
  ShieldCheck,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import type {
  AliasDTO,
  ClientAttachmentMeta,
  ContactDTO,
  DecryptedBody,
  UserDTO,
} from "@nyxmail/shared";
import { isEmail, normalizeEmail } from "@nyxmail/shared";
import {
  decryptAttachmentBytes,
  encryptAttachmentBytes,
  type KeyBundle,
} from "@nyxmail/crypto";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { useToast } from "@/lib/client/toast";
import { useTheme } from "@/lib/client/theme";
import { apiFetch, ApiClientError, downloadAttachment, uploadEncryptedAttachment } from "@/lib/client/api";
import {
  hasContent,
  htmlFromPlainText,
  plainTextFromHtml,
  sanitizeEmailHtml,
  sealCompose,
  sealDraft,
  type DecryptedMail,
} from "@/lib/client/mail-crypto";
import { cn, formatBytes, formatFullDate } from "@/lib/client/utils";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposeSeed {
  mode: ComposeMode;
  source?: DecryptedMail;
  threadId?: string | null;
}

export interface GmailAccountSummary {
  id: string;
  googleEmail: string;
  enabled: boolean;
}

interface ComposeModalProps {
  seed: ComposeSeed;
  user: UserDTO;
  aliases: AliasDTO[];
  gmailAccounts: GmailAccountSummary[];
  contacts: ContactDTO[];
  bundle: KeyBundle;
  onClose: () => void;
  onSent: (info: { to?: string[]; scheduled?: boolean }) => void;
}

interface DraftAttachment extends ClientAttachmentMeta {}

function ownAddressSet(user: UserDTO, aliases: AliasDTO[]): Set<string> {
  return new Set([user.email, ...aliases.map((alias) => alias.address)].map(normalizeEmail));
}

function isLocalOnlyAddress(address: string): boolean {
  const domain = normalizeEmail(address).split("@").pop() ?? "";
  return (
    !domain ||
    !domain.includes(".") ||
    domain === "localhost" ||
    domain.endsWith(".localhost") ||
    domain.endsWith(".local") ||
    domain.endsWith(".internal") ||
    domain.endsWith(".test") ||
    domain.endsWith(".invalid")
  );
}

/**
 * Pick an address that can actually leave the server. Seeded and development
 * accounts often use `user@localhost`; SMTP providers reject that as a sender,
 * so prefer an active alias on a public domain when one exists.
 */
function preferredSender(user: UserDTO, aliases: AliasDTO[]): string {
  const candidates = [
    user.email,
    ...aliases.filter((alias) => alias.active).map((alias) => alias.address),
  ];
  return candidates.find((address) => !isLocalOnlyAddress(address)) ?? user.email;
}

function signatureFor(user: UserDTO): string {
  if (user.signatureHtml?.trim()) {
    return `<div class="nyx-signature">${sanitizeEmailHtml(user.signatureHtml, false).html}</div>`;
  }
  if (user.signatureText?.trim()) {
    const safe = user.signatureText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    return `<div class="nyx-signature">${safe}</div>`;
  }
  return "";
}

function replySubject(subject: string, mode: ComposeMode): string {
  const isReply = mode === "reply" || mode === "replyAll";
  const prefix = isReply ? "Re:" : "Fwd:";
  const clean = subject.trim();
  if (isReply && /^re\s*:/i.test(clean)) return clean;
  if (!isReply && /^fwd?\s*:/i.test(clean)) return clean;
  return `${prefix} ${clean || "(no subject)"}`;
}

function quoteHeader(source: DecryptedMail): string {
  return `<p><br></p><div style="color:#8B93A7;font-size:12px">On ${formatFullDate(source.dto.sentAt)}, ${
    source.dto.fromName || source.dto.fromAddress
  } wrote:</div>`;
}

function buildForwardBody(source: DecryptedMail): string {
  const safe = sanitizeEmailHtml(source.body.html || source.body.text.replace(/\n/g, "<br>"), false);
  return `<p><br></p><div style="color:#8B93A7;font-size:12px">---------- Forwarded message ----------<br>
From: ${source.dto.fromName || ""} &lt;${source.dto.fromAddress}&gt;<br>
Date: ${formatFullDate(source.dto.sentAt)}<br>
Subject: ${source.subject}<br>
To: ${source.dto.toAddresses.map((a) => a.email).join(", ")}</div><br>${safe.html}`;
}

interface InitialState {
  fromAddress: string;
  to: Array<{ email: string; name?: string }>;
  cc: Array<{ email: string; name?: string }>;
  bcc: Array<{ email: string; name?: string }>;
  subject: string;
  html: string;
  draftId: string | null;
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: DraftAttachment[];
}

function buildInitialState(
  seed: ComposeSeed,
  user: UserDTO,
  aliases: AliasDTO[],
): InitialState {
  const own = ownAddressSet(user, aliases);
  const source = seed.source;
  const signature = signatureFor(user);
  if (!source) {
    return {
      fromAddress: preferredSender(user, aliases),
      to: [],
      cc: [],
      bcc: [],
      subject: "",
      html: signature ? `<p><br></p>${signature}<p><br></p>` : "<p><br></p>",
      draftId: null,
      threadId: seed.threadId ?? null,
      inReplyTo: null,
      references: [],
      attachments: [],
    };
  }

  if (seed.mode === "draft") {
    return {
      fromAddress: isLocalOnlyAddress(source.dto.fromAddress)
        ? preferredSender(user, aliases)
        : source.dto.fromAddress,
      to: source.dto.toAddresses,
      cc: source.dto.ccAddresses,
      bcc: source.dto.bccAddresses,
      subject: source.subject,
      html: sanitizeEmailHtml(source.body.html, false).html,
      draftId: source.dto.id,
      threadId: source.dto.threadId,
      inReplyTo: source.dto.inReplyTo,
      references: source.dto.references,
      attachments: source.body.attachments,
    };
  }

  if (seed.mode === "forward") {
    return {
      fromAddress: preferredSender(user, aliases),
      to: [],
      cc: [],
      bcc: [],
      subject: replySubject(source.subject, seed.mode),
      html: `${buildForwardBody(source)}${signature ? `<p><br></p>${signature}` : ""}`,
      draftId: null,
      threadId: null,
      inReplyTo: null,
      references: [],
      attachments: [],
    };
  }

  const sourceFromOwn = own.has(normalizeEmail(source.dto.fromAddress));
  const primaryTarget = sourceFromOwn
    ? [...source.dto.toAddresses, ...source.dto.ccAddresses].find(
        (address) => !own.has(normalizeEmail(address.email)),
      )?.email ?? source.dto.toAddresses[0]?.email
    : source.dto.fromAddress;
  const to = primaryTarget
    ? [{ email: primaryTarget, name: sourceFromOwn ? undefined : source.dto.fromName ?? undefined }]
    : [];
  const cc =
    seed.mode === "replyAll"
      ? [...source.dto.toAddresses, ...source.dto.ccAddresses].filter(
          (address) =>
            !own.has(normalizeEmail(address.email)) &&
            normalizeEmail(address.email) !== normalizeEmail(primaryTarget || ""),
        )
      : [];
  const quoted = sanitizeEmailHtml(
    source.body.html || source.body.text.replace(/\n/g, "<br>"),
    false,
  ).html;
  const matchedSender =
    [source.dto.fromAddress, ...source.dto.toAddresses.map((item) => item.email)].find((address) =>
      own.has(normalizeEmail(address)),
    ) ?? user.email;
  const hasExternalTarget = [...to, ...cc].some((address) => !isLocalOnlyAddress(address.email));
  const fromAddress =
    isLocalOnlyAddress(matchedSender) && hasExternalTarget
      ? preferredSender(user, aliases)
      : matchedSender;
  return {
    fromAddress,
    to,
    cc,
    bcc: [],
    subject: replySubject(source.subject, seed.mode),
    html: `${signature ? `${signature}<p><br></p>` : ""}${quoteHeader(source)}<blockquote style="margin:0 0 0 12px;padding-left:12px;border-left:2px solid #8B93A7">${quoted}</blockquote><p><br></p>`,
    draftId: null,
    threadId: source.dto.threadId,
    inReplyTo: source.dto.messageIdHeader,
    references: Array.from(new Set([...source.dto.references, source.dto.messageIdHeader].filter(Boolean) as string[])),
    attachments: [],
  };
}

function AddressField({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
}: {
  label: string;
  value: Array<{ email: string; name?: string }>;
  onChange: (next: Array<{ email: string; name?: string }>) => void;
  contacts: ContactDTO[];
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useMemo(() => {
    const query = input.toLowerCase().trim();
    if (!query) return contacts.slice(0, 5);
    return contacts
      .filter(
        (contact) =>
          contact.name.toLowerCase().includes(query) ||
          contact.email.toLowerCase().includes(query),
      )
      .filter((contact) => !value.some((item) => item.email === contact.email))
      .slice(0, 6);
  }, [contacts, input, value]);

  const addAddress = (emailRaw: string, name?: string) => {
    const email = normalizeEmail(emailRaw);
    setError(null);
    if (!isEmail(email)) {
      setError("That address doesn't look valid.");
      return false;
    }
    if (value.some((item) => item.email === email)) {
      setInput("");
      return true;
    }
    onChange([...value, { email, ...(name ? { name } : {}) }]);
    setInput("");
    return true;
  };

  return (
    <div className="border-b border-border px-4 py-2">
      <div className="flex min-h-8 items-start gap-2">
        <span className="w-11 shrink-0 pt-1.5 text-[11px] font-medium text-muted">{label}</span>
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {value.map((address) => (
            <span
              key={address.email}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-raised px-2 py-1 text-[11px] text-ink"
            >
              <span className="truncate">{address.name || address.email}</span>
              <button
                type="button"
                className="text-faint hover:text-danger"
                onClick={() => onChange(value.filter((item) => item.email !== address.email))}
                aria-label={`Remove ${address.email}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <div className="relative min-w-[120px] flex-1">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setTimeout(() => setFocused(false), 150);
                if (input.trim()) addAddress(input.trim());
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "," || event.key === ";") {
                  event.preventDefault();
                  if (input.trim()) addAddress(input.trim());
                } else if (event.key === "Backspace" && !input && value.length > 0) {
                  onChange(value.slice(0, -1));
                }
              }}
              placeholder={value.length === 0 ? "name@example.com" : ""}
              aria-label={`${label} recipients`}
              className="w-full bg-transparent py-1 text-[12px] text-ink placeholder:text-faint outline-none"
              autoFocus={autoFocus}
              autoComplete="off"
            />
            {focused && suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
                {suggestions.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-raised"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addAddress(contact.email, contact.name)}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-[9px] font-semibold text-accent2">
                      {(contact.name || contact.email).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-ink">{contact.name || contact.email}</span>
                      <span className="block truncate text-[10px] text-faint">{contact.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {error && <p className="ml-13 mt-1 text-[10px] text-danger">{error}</p>}
    </div>
  );
}

function RichEditor({
  initialHtml,
  editorKey,
  onChange,
  plain,
  plainText,
  onPlainTextChange,
  onFiles,
  onInsertImage,
}: {
  initialHtml: string;
  editorKey: number;
  onChange: (html: string) => void;
  plain: boolean;
  plainText: string;
  onPlainTextChange: (text: string) => void;
  onFiles: (files: FileList | File[]) => void;
  onInsertImage: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!plain && editorRef.current && editorRef.current.innerHTML !== initialHtml) {
      editorRef.current.innerHTML = initialHtml;
    }
    // initialHtml is updated after switching modes; typing does not re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey, plain]);

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const formatBlock = (tag: string) => {
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, tag);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  if (plain) {
    return (
      <textarea
        value={plainText}
        onChange={(event) => onPlainTextChange(event.target.value)}
        className="min-h-[280px] w-full flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
        placeholder="Write your message in plain text…"
        aria-label="Plain text message body"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        {[
          { icon: Bold, label: "Bold", command: "bold" },
          { icon: Italic, label: "Italic", command: "italic" },
          { icon: Underline, label: "Underline", command: "underline" },
        ].map(({ icon: Icon, label, command }) => (
          <button
            key={command}
            type="button"
            className="icon-btn h-7 w-7"
            aria-label={label}
            title={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => exec(command)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          className="icon-btn h-7 w-7"
          aria-label="Bulleted list"
          title="Bulleted list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("insertUnorderedList")}
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="icon-btn h-7 w-7"
          aria-label="Numbered list"
          title="Numbered list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("insertOrderedList")}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="icon-btn h-7 w-7"
          aria-label="Quote"
          title="Quote"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => formatBlock("blockquote")}
        >
          <Quote className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="icon-btn h-7 w-7"
          aria-label="Insert link"
          title="Insert link"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const url = window.prompt("Link URL (https://…)");
            if (url) exec("createLink", url);
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="icon-btn h-7 w-7"
          aria-label="Insert inline image"
          title="Insert inline image"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertImage}
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {dragOver && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent/50 bg-accent/[0.06] text-xs font-medium text-accent2">
            Drop files to encrypt and attach
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Message body"
          onInput={(event) => onChange((event.target as HTMLDivElement).innerHTML)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
          }}
          className="min-h-[280px] px-4 py-3 text-[13.5px] leading-relaxed text-ink outline-none [&_a]:text-accent2 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_img]:max-w-full"
        />
      </div>
    </div>
  );
}

export function ComposeModal({
  seed,
  user,
  aliases,
  gmailAccounts,
  contacts,
  bundle,
  onClose,
  onSent,
}: ComposeModalProps) {
  const initial = useMemo(() => buildInitialState(seed, user, aliases), [seed, user, aliases]);
  const { toast } = useToast();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [fromAddress, setFromAddress] = useState(initial.fromAddress);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [html, setHtml] = useState(initial.html);
  const [plain, setPlain] = useState(false);
  const [plainText, setPlainText] = useState(plainTextFromHtml(initial.html));
  const [editorKey, setEditorKey] = useState(0);
  const [attachments, setAttachments] = useState<DraftAttachment[]>(initial.attachments);
  const [draftId, setDraftId] = useState<string | null>(initial.draftId);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [preparingForward, setPreparingForward] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [dirty, setDirty] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const sendingRef = useRef(false);
  const forwardStarted = useRef(false);
  const mountedForDirty = useRef(false);
  const stateRef = useRef({ fromAddress, to, cc, bcc, subject, html, plain, plainText, attachments });

  stateRef.current = { fromAddress, to, cc, bcc, subject, html, plain, plainText, attachments };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mountedForDirty.current) {
      mountedForDirty.current = true;
      return;
    }
    dirtyRef.current = true;
    setDirty(true);
  }, [fromAddress, to, cc, bcc, subject, html, plainText, attachments]);

  const recipients = useMemo(
    () => [...to, ...cc, ...bcc].map((address) => normalizeEmail(address.email)),
    [to, cc, bcc],
  );

  const saveDraft = async (silent = true) => {
    if (sendingRef.current) return;
    const current = stateRef.current;
    if (
      !hasContent({
        subject: current.subject,
        html: current.html,
        recipients: [...current.to, ...current.cc, ...current.bcc].map((item) => item.email),
        attachments: current.attachments,
      })
    ) {
      return;
    }
    const revision = revisionRef.current;
    setSaveState("saving");
    try {
      const sealed = await sealDraft({
        subject: current.subject,
        html: current.html,
        text: current.plain ? current.plainText : plainTextFromHtml(current.html),
        attachments: current.attachments,
        bundle,
        accountEmail: user.email,
      });
      const result = await apiFetch<{ draftId: string }>("/api/v1/messages/draft", {
        method: "POST",
        body: JSON.stringify({
          id: draftId || undefined,
          fromAddress: current.fromAddress,
          to: current.to,
          cc: current.cc,
          bcc: current.bcc,
          sealed,
          attachments: current.attachments.map((attachment) => ({
            blobId: attachment.blobId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            contentId: attachment.contentId,
            inline: attachment.inline,
          })),
          threadId: initial.threadId,
          inReplyTo: initial.inReplyTo,
          references: initial.references,
        }),
      });
      setDraftId(result.draftId);
      if (revisionRef.current === revision) {
        dirtyRef.current = false;
        setDirty(false);
      }
      setSaveState("saved");
    } catch {
      setSaveState("idle");
      if (!silent) setError("Draft could not be saved. Your message is still here.");
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current && !sendingRef.current) void saveDraft(true);
    }, 3000);
    return () => clearInterval(interval);
    // saveDraft reads live state via ref; the interval is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, draftId, user.email]);

  const markDirty = () => {
    revisionRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState("idle");
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      if (file.size > 25 * 1024 * 1024) {
        toast({ title: `${file.name} is over 25MB`, tone: "error" });
        continue;
      }
      setUploading((current) => current + 1);
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const encrypted = await encryptAttachmentBytes(buffer);
        const uploaded = await uploadEncryptedAttachment({
          ciphertext: encrypted.ciphertext,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });
        const attachment: DraftAttachment = {
          id: uploaded.attachment.blobId,
          blobId: uploaded.attachment.blobId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          key: encrypted.key,
          contentId: null,
          inline: false,
        };
        setAttachments((current) => [...current, attachment]);
        markDirty();
      } catch (caught) {
        toast({
          title: "Attachment could not be encrypted",
          description: caught instanceof ApiClientError ? caught.message : undefined,
          tone: "error",
        });
      } finally {
        setUploading((current) => Math.max(0, current - 1));
      }
    }
  };

  useEffect(() => {
    if (seed.mode !== "forward" || !seed.source || forwardStarted.current) return;
    forwardStarted.current = true;
    const sourceAttachments = seed.source.body.attachments;
    if (sourceAttachments.length === 0) return;
    setPreparingForward(true);
    (async () => {
      for (const sourceAttachment of sourceAttachments) {
        try {
          const encrypted = await downloadAttachment(sourceAttachment.blobId);
          const plain = await decryptAttachmentBytes(
            new Uint8Array(encrypted),
            sourceAttachment.key,
          );
          const reencrypted = await encryptAttachmentBytes(plain);
          const uploaded = await uploadEncryptedAttachment({
            ciphertext: reencrypted.ciphertext,
            filename: sourceAttachment.filename,
            mimeType: sourceAttachment.mimeType,
            sizeBytes: sourceAttachment.sizeBytes,
          });
          setAttachments((current) => [
            ...current,
            {
              id: uploaded.attachment.blobId,
              blobId: uploaded.attachment.blobId,
              filename: sourceAttachment.filename,
              mimeType: sourceAttachment.mimeType,
              sizeBytes: sourceAttachment.sizeBytes,
              key: reencrypted.key,
              contentId: null,
              inline: false,
            },
          ]);
          markDirty();
        } catch {
          toast({ title: `Could not forward ${sourceAttachment.filename}`, tone: "error" });
        }
      }
      setPreparingForward(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const insertInlineImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Choose an image file", tone: "error" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Inline images are limited to 2MB", tone: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "").replace(/"/g, "&quot;");
      setHtml((current) => `${current}<p><img src="${dataUrl}" alt="inline image" style="max-width:100%" /></p>`);
      setEditorKey((key) => key + 1);
      markDirty();
    };
    reader.readAsDataURL(file);
  };

  const selectedGmail =
    gmailAccounts.find(
      (account) => normalizeEmail(account.googleEmail) === normalizeEmail(fromAddress),
    ) ?? null;

  const send = async () => {
    setError(null);
    if (recipients.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    if (recipients.some((address) => !isEmail(address))) {
      setError("One of the recipients is not a valid email address.");
      return;
    }
    if (preparingForward || uploading > 0) {
      setError("Wait for attachments to finish encrypting.");
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    try {
      const finalHtml = plain ? htmlFromPlainText(plainText) : html;
      const finalText = plain ? plainText : plainTextFromHtml(html);
      const { sealed, externalAddresses } = await sealCompose({
        subject,
        html: finalHtml,
        text: finalText,
        attachments,
        fromAddress,
        accountEmail: user.email,
        recipientAddresses: recipients,
        bundle,
      });
      const isScheduled = Boolean(scheduledFor);
      const response = await apiFetch<{ scheduled?: boolean; externalRecipients?: number; warnings?: string[] }>(
        "/api/v1/messages/send",
        {
          method: "POST",
          body: JSON.stringify({
            fromAddress,
            gmailAccountId: selectedGmail?.id ?? null,
            to,
            cc,
            bcc,
            sealed,
            draftId,
            threadId: initial.threadId,
            inReplyTo: initial.inReplyTo,
            references: initial.references,
            scheduledFor: isScheduled ? new Date(scheduledFor).toISOString() : null,
            relay:
              externalAddresses.length > 0
                ? {
                    subject: subject || "(no subject)",
                    html: finalHtml,
                    text: finalText,
                    attachmentKeys: Object.fromEntries(
                      attachments.map((attachment) => [attachment.blobId, attachment.key]),
                    ),
                  }
                : null,
            attachments: attachments.map((attachment) => ({
              blobId: attachment.blobId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              contentId: attachment.contentId,
              inline: attachment.inline,
            })),
          }),
        },
      );
      dirtyRef.current = false;
      if (isScheduled) {
        toast({
          title: "Message scheduled",
          description: new Date(scheduledFor).toLocaleString(),
          tone: "success",
        });
      } else {
        toast({
          title: "Message sent",
          description:
            response.externalRecipients && response.externalRecipients > 0
              ? `Delivered to ${response.externalRecipients} external recipient${response.externalRecipients === 1 ? "" : "s"} via your relay.`
              : "Encrypted copies were delivered locally.",
          tone: "success",
        });
        if (response.warnings?.length) {
          toast({ title: "Some deliveries were skipped", description: response.warnings[0], tone: "warning" });
        }
      }
      onSent({ to: recipients, scheduled: isScheduled });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Message could not be sent.");
    } finally {
      setBusy(false);
      sendingRef.current = false;
    }
  };

  const close = () => {
    if (dirtyRef.current) void saveDraft(true);
    onClose();
  };

  if (!mounted) return null;

  const modes: Record<ComposeMode, string> = {
    new: "New message",
    reply: "Reply",
    replyAll: "Reply all",
    forward: "Forward",
    draft: "Edit draft",
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-start sm:justify-end sm:p-4">
      <motion.button
        type="button"
        aria-label="Close composer"
        className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={close}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={modes[seed.mode]}
        initial={{ opacity: 0, y: 36, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.9 }}
        className="compose-editor relative z-10 flex h-[95vh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-soft sm:h-[calc(100vh-2rem)] sm:w-[min(720px,calc(100vw-2rem))] sm:rounded-2xl"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent" />
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent2">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-xs font-semibold text-ink">{modes[seed.mode]}</p>
              <p className="text-[9px] text-faint">
                {dirty ? "Unsaved changes" : saveState === "saving" ? "Encrypting draft…" : saveState === "saved" ? "Draft saved" : "Encrypted before upload"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="hidden items-center gap-1 rounded-full border border-success/20 bg-success/[0.06] px-2 py-1 text-[9px] font-medium text-success sm:inline-flex">
              <LockKeyhole className="h-2.5 w-2.5" /> End-to-end
            </span>
            <button type="button" className="icon-btn h-8 w-8" onClick={close} aria-label="Close composer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 border-b border-danger/20 bg-danger/[0.06] px-4 py-2 text-[11px] text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex shrink-0 items-center border-b border-border px-4 py-2">
          <span className="w-11 text-[11px] font-medium text-muted">From</span>
          <Dropdown
            align="start"
            width={330}
            header="Send from"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Sender address"
                className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-transparent px-1.5 text-left text-[12px] text-ink transition-colors hover:border-border hover:bg-raised/40 focus:border-accent/50"
              >
                <span className="truncate">{fromAddress}</span>
                {selectedGmail ? (
                  <span className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-brand">
                    Gmail
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-mint/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-mint">
                    E2E
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "ml-auto h-3.5 w-3.5 shrink-0 text-faint transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
            )}
            sections={[
              {
                heading: "Your identities",
                items: [
                  {
                    key: user.email,
                    label: user.email,
                    hint: "Primary encrypted address",
                    checked: fromAddress === user.email,
                    onSelect: () => {
                      setFromAddress(user.email);
                      markDirty();
                    },
                  },
                  ...aliases
                    .filter((alias) => alias.active)
                    .map((alias) => ({
                      key: alias.id,
                      label: alias.address,
                      hint: "Alias · encrypted delivery",
                      checked: fromAddress === alias.address,
                      onSelect: () => {
                        setFromAddress(alias.address);
                        markDirty();
                      },
                    })),
                ],
              },
              ...(gmailAccounts.filter((account) => account.enabled).length > 0
                ? [
                    {
                      heading: "Connected Gmail",
                      items: gmailAccounts
                        .filter((account) => account.enabled)
                        .map((account) => ({
                          key: account.id,
                          label: account.googleEmail,
                          hint: "Gmail signs and delivers external recipients",
                          checked: fromAddress === account.googleEmail,
                          onSelect: () => {
                            setFromAddress(account.googleEmail);
                            markDirty();
                          },
                        })),
                    },
                  ]
                : []),
            ]}
          />
          <button
            type="button"
            className="text-[11px] text-faint hover:text-muted"
            onClick={() => {
              setShowCc(true);
              setCcOpen((current) => !current);
            }}
          >
            Cc/Bcc
          </button>
        </div>

        <div>
          {!ccOpen ? (
            <AddressField
              label="To"
              value={to}
              onChange={(next) => {
                setTo(next);
                markDirty();
              }}
              contacts={contacts}
              autoFocus={to.length === 0}
            />
          ) : (
            <>
              <AddressField label="To" value={to} onChange={(next) => { setTo(next); markDirty(); }} contacts={contacts} autoFocus />
              <AddressField label="Cc" value={cc} onChange={(next) => { setCc(next); markDirty(); }} contacts={contacts} />
              <AddressField label="Bcc" value={bcc} onChange={(next) => { setBcc(next); markDirty(); }} contacts={contacts} />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="w-11 shrink-0 text-[11px] font-medium text-muted">Subject</span>
          <input
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
              markDirty();
            }}
            placeholder="Subject"
            className="h-8 flex-1 bg-transparent text-[13px] font-medium text-ink placeholder:text-faint outline-none"
            aria-label="Subject"
          />
        </div>

        <RichEditor
          key={`${plain}-${editorKey}`}
          initialHtml={html}
          editorKey={editorKey}
          onChange={(next) => {
            setHtml(next);
            markDirty();
          }}
          plain={plain}
          plainText={plainText}
          onPlainTextChange={(next) => {
            setPlainText(next);
            markDirty();
          }}
          onFiles={(files) => void addFiles(files)}
          onInsertImage={() => inlineInputRef.current?.click()}
        />

        <div className="shrink-0 border-t border-border bg-surface">
          {(attachments.length > 0 || uploading > 0 || preparingForward) && (
            <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2.5">
              {attachments.map((attachment) => (
                <span
                  key={attachment.blobId}
                  className="inline-flex max-w-[220px] items-center gap-2 rounded-lg border border-border bg-canvas px-2 py-1.5 text-[10px] text-ink"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-faint" />
                  <span className="truncate">{attachment.filename}</span>
                  <span className="shrink-0 text-faint">{formatBytes(attachment.sizeBytes)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachments((current) => current.filter((item) => item.blobId !== attachment.blobId));
                      markDirty();
                    }}
                    className="text-faint hover:text-danger"
                    aria-label={`Remove ${attachment.filename}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {uploading > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-2 py-1.5 text-[10px] text-faint">
                  <Loader2 className="h-3 w-3 animate-spin" /> Encrypting {uploading}…
                </span>
              )}
              {preparingForward && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-2 py-1.5 text-[10px] text-faint">
                  <Loader2 className="h-3 w-3 animate-spin" /> Copying attachments…
                </span>
              )}
            </div>
          )}

          {showSchedule && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/[0.03] px-4 py-2">
              <CalendarClock className="h-3.5 w-3.5 text-accent2" />
              <label htmlFor="scheduledFor" className="text-[10px] font-medium text-muted">
                Send at
              </label>
              <input
                id="scheduledFor"
                type="datetime-local"
                value={scheduledFor}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(event) => setScheduledFor(event.target.value)}
                className="rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink outline-none focus:border-accent/50"
              />
              {scheduledFor && (
                <button type="button" className="text-[10px] text-faint underline" onClick={() => setScheduledFor("")}>
                  clear
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex items-center gap-0.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <input
                ref={inlineInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void insertInlineImage(event)}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach files"
                title="Attach files (up to 25MB each)"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn("icon-btn", showSchedule && "bg-accent/10 text-accent2")}
                onClick={() => setShowSchedule((current) => !current)}
                aria-label="Schedule send"
                title="Schedule send"
              >
                <CalendarClock className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn("rounded-lg px-2 py-1 text-[10px] font-medium", plain ? "bg-accent/10 text-accent2" : "text-faint hover:text-muted")}
                onClick={() => {
                  if (plain) {
                    const nextHtml = htmlFromPlainText(plainText);
                    setHtml(nextHtml);
                    setEditorKey((key) => key + 1);
                    setPlain(false);
                  } else {
                    setPlainText(plainTextFromHtml(html));
                    setPlain(true);
                  }
                  markDirty();
                }}
              >
                {plain ? "Rich text" : "Plain text"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={close}
                className="btn btn-ghost btn-sm"
                disabled={busy}
              >
                Close
              </button>
              <div className="flex items-center">
                <Button
                  size="sm"
                  loading={busy}
                  disabled={preparingForward || uploading > 0}
                  onClick={() => void send()}
                  className="rounded-r-none"
                  icon={!busy ? <ShieldCheck className="h-3.5 w-3.5" /> : undefined}
                >
                  {scheduledFor ? "Schedule" : "Send encrypted"}
                </Button>
                <button
                  type="button"
                  className="btn btn-primary h-[34px] rounded-l-none border-l border-white/20 px-2"
                  onClick={() => setShowSchedule((current) => !current)}
                  aria-label="Scheduling options"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-[9px] text-faint">
            <span className="inline-flex items-center gap-1">
              <LockKeyhole className="h-2.5 w-2.5" />
              Sealed with X25519 · draft encrypted with Argon2id key
            </span>
            <span className={cn(!dirty && "opacity-60")}>
              {theme === "dark" ? "Dark" : "Light"} reading theme
            </span>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
