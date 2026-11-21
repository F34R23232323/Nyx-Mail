"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/client/utils";

export type ConfirmTone = "danger" | "warning" | "accent";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  icon?: ReactNode;
  count?: number;
  details?: Array<{ label: string; value: string }>;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

const TONES: Record<
  ConfirmTone,
  { icon: ReactNode; ring: string; halo: string; bar: string; button: "danger" | "primary" }
> = {
  danger: {
    icon: <Trash2 className="h-5 w-5" />,
    ring: "border-danger/30 bg-danger/10 text-danger",
    halo: "bg-danger/20",
    bar: "from-danger via-brand to-danger",
    button: "danger",
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5" />,
    ring: "border-warning/35 bg-warning/10 text-warning",
    halo: "bg-warning/20",
    bar: "from-warning via-brand to-warning",
    button: "danger",
  },
  accent: {
    icon: <ShieldAlert className="h-5 w-5" />,
    ring: "border-accent/35 bg-accent/10 text-accent2",
    halo: "bg-accent/20",
    bar: "from-accent via-accent2 to-mint",
    button: "primary",
  },
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  icon,
  count,
  details,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  useEffect(() => {
    if (!open) {
      setBusy(false);
      setFailed(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"),
      ).filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("[data-confirm]")?.focus();
    }, 60);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  if (!mounted) return null;
  const palette = TONES[tone];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[96] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.button
            type="button"
            aria-label="Close confirmation"
            className="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => {
              if (!busy) onClose();
            }}
          />
          <motion.div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}
            className="relative w-full overflow-hidden rounded-t-3xl border border-border bg-surface shadow-soft sm:max-w-[420px] sm:rounded-3xl"
          >
            <div className={cn("h-1 w-full bg-gradient-to-r", palette.bar)} />
            <div
              className={cn(
                "pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl",
                palette.halo,
              )}
            />
            <div className="relative px-6 pb-5 pt-6 text-center">
              <motion.div
                initial={{ scale: 0.6, rotate: -14, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 20, delay: 0.06 }}
                className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              >
                <span
                  className={cn(
                    "absolute inset-0 m-auto h-14 w-14 animate-ping rounded-2xl opacity-30",
                    palette.halo,
                  )}
                  style={{ animationDuration: "2.4s" }}
                />
                <span
                  className={cn(
                    "relative flex h-14 w-14 items-center justify-center rounded-2xl border",
                    palette.ring,
                  )}
                >
                  {icon ?? palette.icon}
                </span>
              </motion.div>
              <h2 className="text-balance text-[18px] font-semibold tracking-[-0.02em] text-ink">
                {title}
              </h2>
              {description && (
                <p className="mx-auto mt-2 max-w-[320px] text-[12.5px] leading-relaxed text-muted">
                  {description}
                </p>
              )}
              {typeof count === "number" && count > 0 && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-raised/60 px-3 py-1 text-[11px] font-medium text-ink">
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger/15 px-1.5 text-[10px] font-bold text-danger">
                    {count}
                  </span>
                  conversation{count === 1 ? "" : "s"} selected
                </div>
              )}
              {details && details.length > 0 && (
                <div className="mt-4 space-y-1.5 rounded-xl border border-border/70 bg-canvas/60 p-3 text-left">
                  {details.slice(0, 3).map((detail) => (
                    <div key={detail.label} className="flex items-start gap-2 text-[11px]">
                      <span className="w-20 shrink-0 text-faint">{detail.label}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink/90">
                        {detail.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {failed && (
                <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">
                  Something went wrong. Please try again.
                </p>
              )}
            </div>
            <div className="relative flex flex-col-reverse gap-2 border-t border-border/60 bg-canvas/40 px-5 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={busy}
                className="sm:min-w-[88px]"
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                data-confirm
                variant={palette.button}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setFailed(false);
                  try {
                    await onConfirm();
                  } catch {
                    setFailed(true);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="sm:min-w-[128px]"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
