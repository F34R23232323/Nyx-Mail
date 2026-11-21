import type { ReactNode } from "react";
import Link from "next/link";

type Kind = "inbox" | "folder" | "search" | "starred" | "trash";

const COPY: Record<Kind, { title: string; body: string; cta?: string }> = {
  inbox: {
    title: "Inbox",
    body: "You have no conversations in this category yet. New mail arrives here as soon as it is delivered.",
  },
  folder: {
    title: "Nothing in this folder yet",
    body: "Move a conversation here from the reading pane, or create a filter to route mail automatically.",
  },
  search: {
    title: "No matching messages",
    body: "Search runs locally against a decrypted index in this browser. Try a different sender, subject or word.",
  },
  starred: {
    title: "No starred messages",
    body: "Star the things you want to come back to. Stars stay attached to the message, even across folders.",
  },
  trash: {
    title: "Trash is empty",
    body: "Deleted messages stay here for 30 days, then the worker purges them permanently.",
  },
};

export function InboxIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 140" className={className} aria-hidden="true">
      <g opacity=".9">
        <rect x="43" y="16" width="94" height="76" rx="7" fill="rgb(var(--faint) / 0.18)" />
        <rect x="36" y="25" width="108" height="76" rx="7" fill="rgb(var(--faint) / 0.3)" />
        <rect x="30" y="36" width="120" height="74" rx="7" fill="rgb(var(--faint) / 0.48)" />
        <path d="M44 52h92M44 63h74M44 74h84" stroke="rgb(var(--canvas) / 0.55)" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <path
        d="M22 92c0-4 3.2-7 7.2-7h121.6c4 0 7.2 3 7.2 7v17c0 8.3-6.7 15-15 15H37c-8.3 0-15-6.7-15-15V92Z"
        fill="rgb(var(--faint) / 0.58)"
      />
      <path
        d="M22 96h40.5c2.8 0 5.3 1.6 6.5 4.1 2.2 4.4 6.7 7.2 11.6 7.2h13.8c4.9 0 9.4-2.8 11.6-7.2 1.2-2.5 3.7-4.1 6.5-4.1H158v12c0 9.4-7.6 17-17 17H39c-9.4 0-17-7.6-17-17V96Z"
        fill="rgb(var(--faint) / 0.82)"
      />
      <path d="M22 98h40.5c2.8 0 5.3 1.6 6.5 4.1 2.2 4.4 6.7 7.2 11.6 7.2h13.8c4.9 0 9.4-2.8 11.6-7.2 1.2-2.5 3.7-4.1 6.5-4.1H158" stroke="rgb(var(--canvas) / 0.24)" strokeWidth="2" />
      <ellipse cx="90" cy="130" rx="48" ry="4" fill="rgb(var(--canvas) / 0.5)" />
    </svg>
  );
}

export function EmptyState({
  kind,
  title,
  description,
  action,
}: {
  kind: Kind;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const copy = COPY[kind];
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-[62%] rounded-full bg-accent/[0.08] blur-3xl" />
      <div className="animate-float">
        <InboxIllustration className="mb-7 h-[104px] w-[134px]" />
      </div>
      <h2 className="relative text-[16px] font-semibold text-ink">{title ?? copy.title}</h2>
      <p className="relative mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description ?? copy.body}</p>
      <div className="relative">{action}</div>
      {copy.cta && (
        <Link href="/settings?tab=imports" className="btn btn-secondary btn-sm relative mt-5">
          {copy.cta}
        </Link>
      )}
    </div>
  );
}
