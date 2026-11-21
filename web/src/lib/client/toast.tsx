"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  action?: ToastAction;
}

interface ToastRecord extends ToastInput {
  id: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
  error: <XCircle className="h-4 w-4 text-danger" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning" />,
  info: <Info className="h-4 w-4 text-accent2" />,
};

const TONE_STYLES: Record<ToastTone, { icon: string; edge: string; bar: string }> = {
  success: {
    icon: "border-success/25 bg-success/10",
    edge: "before:bg-success",
    bar: "bg-gradient-to-r from-success to-mint",
  },
  error: {
    icon: "border-danger/25 bg-danger/10",
    edge: "before:bg-danger",
    bar: "bg-gradient-to-r from-danger to-brand",
  },
  warning: {
    icon: "border-warning/25 bg-warning/10",
    edge: "before:bg-warning",
    bar: "bg-gradient-to-r from-warning to-brand",
  },
  info: {
    icon: "border-accent/25 bg-accent/10",
    edge: "before:bg-accent",
    bar: "bg-gradient-to-r from-accent to-accent2",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timerMap = timers.current;
    return () => {
      for (const timer of timerMap.values()) clearTimeout(timer);
      timerMap.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const record: ToastRecord = { ...input, id };
      setToasts((current) => [...current.slice(-3), record]);
      const duration = input.duration ?? (input.action ? 5000 : 4500);
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-live="polite"
            aria-atomic="false"
            className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
          >
            <AnimatePresence initial={false}>
              {toasts.map((item) => {
                const tone = item.tone ?? "info";
                const duration = item.duration ?? (item.action ? 5000 : 4500);
                return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 40, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.8 }}
                  className={`pointer-events-auto group relative flex w-full max-w-md items-start gap-3 overflow-hidden rounded-2xl border border-border/90 bg-surface/95 p-3.5 pl-4 shadow-soft backdrop-blur-xl before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${TONE_STYLES[tone].edge}`}
                  role="status"
                >
                  <motion.span
                    initial={{ scale: 0.5, rotate: -18, opacity: 0 }}
                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 20, delay: 0.05 }}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${TONE_STYLES[tone].icon}`}
                  >
                    {ICONS[tone]}
                  </motion.span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-ink">{item.title}</p>
                    {item.description && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.description}</p>
                    )}
                  </div>
                  {item.action && (
                    <button
                      type="button"
                      className="rounded-lg border border-border/70 px-2 py-1 text-[11px] font-semibold text-accent2 transition-colors hover:border-accent/40 hover:bg-accent/10"
                      onClick={async () => {
                        await item.action?.onClick();
                        dismiss(item.id);
                      }}
                    >
                      {item.action.label}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    className="rounded-md p-1 text-faint transition-colors hover:text-ink"
                    onClick={() => dismiss(item.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <span
                    className={`toast-progress absolute inset-x-0 bottom-0 h-[2px] origin-left ${TONE_STYLES[tone].bar}`}
                    style={{ animationDuration: `${duration}ms` }}
                  />
                </motion.div>
                );
              })}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
