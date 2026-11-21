"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/client/utils";

export interface DropdownItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: string;
  trailing?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  closeOnSelect?: boolean;
}

export interface DropdownSection {
  heading?: string;
  items: DropdownItem[];
}

interface DropdownProps {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  sections: DropdownSection[];
  align?: "start" | "end";
  width?: number;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  panelClassName?: string;
}

export function Dropdown({
  trigger,
  sections,
  align = "end",
  width = 224,
  header,
  footer,
  className,
  panelClassName,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const triggerElement = rootRef.current;
    const panel = panelRef.current;
    if (!triggerElement || !panel) return;
    const triggerRect = triggerElement.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = 12;
    const gap = 6;

    let left = align === "end" ? triggerRect.right - panelRect.width : triggerRect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));

    let top = triggerRect.bottom + gap;
    if (top + panelRect.height > window.innerHeight - margin) {
      const above = triggerRect.top - panelRect.height - gap;
      top =
        above >= margin
          ? above
          : Math.max(margin, window.innerHeight - panelRect.height - margin);
    }
    setPlacement({ left, top });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [open, updatePosition, width]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        rootRef.current?.querySelector<HTMLElement>("[aria-haspopup='menu']")?.focus?.();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
      ).filter((item) => !item.disabled);
      if (items.length === 0) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    const onResize = () => updatePosition();
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    }, 40);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(focusTimer);
    };
  }, [open, updatePosition]);

  let itemIndex = 0;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                role="menu"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: "fixed",
                  left: placement?.left ?? 0,
                  top: placement?.top ?? 0,
                  width,
                  transformOrigin: align === "end" ? "top right" : "top left",
                  visibility: placement ? "visible" : "hidden",
                }}
                className={cn(
                  "z-[94] max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain rounded-xl border border-border/90 bg-surface/95 p-1 shadow-soft backdrop-blur-xl",
                  panelClassName,
                )}
              >
                {header && (
                  <div className="border-b border-border/60 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                    {header}
                  </div>
                )}
                {sections.map((section, sectionIndex) => {
                  if (section.items.length === 0) return null;
                  return (
                    <div key={section.heading ?? `section-${sectionIndex}`}>
                      {section.heading && (
                        <p className="px-2.5 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
                          {section.heading}
                        </p>
                      )}
                      {section.items.map((item) => {
                        const index = itemIndex++;
                        return (
                          <motion.button
                            key={item.key}
                            type="button"
                            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                            aria-checked={item.checked}
                            disabled={item.disabled}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.14, delay: Math.min(index * 0.012, 0.12) }}
                            onClick={() => {
                              item.onSelect?.();
                              if (item.closeOnSelect !== false) setOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors",
                              item.danger
                                ? "text-danger hover:bg-danger/10"
                                : "text-ink hover:bg-raised/80",
                              item.disabled && "cursor-not-allowed opacity-40",
                              item.checked && "bg-accent/[0.07]",
                            )}
                          >
                            {item.icon && (
                              <span
                                className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                                  item.danger
                                    ? "bg-danger/10 text-danger"
                                    : item.checked
                                      ? "bg-accent/15 text-accent2"
                                      : "bg-raised/70 text-muted",
                                )}
                              >
                                {item.icon}
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{item.label}</span>
                              {item.hint && (
                                <span className="mt-0.5 block truncate text-[10px] text-faint">
                                  {item.hint}
                                </span>
                              )}
                            </span>
                            {item.trailing}
                            {item.checked !== undefined && (
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                                  item.checked
                                    ? "border-accent bg-accent text-white"
                                    : "border-borderStrong/70",
                                )}
                              >
                                {item.checked && <Check className="h-2.5 w-2.5" />}
                              </span>
                            )}
                          </motion.button>
                        );
                      })}
                      {sectionIndex < sections.length - 1 && (
                        <div className="my-1 h-px bg-border/60" />
                      )}
                    </div>
                  );
                })}
                {footer && (
                  <div className="mt-1 border-t border-border/60 pt-1">{footer}</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
