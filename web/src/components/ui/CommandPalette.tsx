"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, CornerDownLeft, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/client/utils";

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  section: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: string;
  onRun: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
}

export function CommandPalette({
  open,
  onClose,
  items,
  placeholder = "Search actions, folders and conversations…",
}: CommandPaletteProps) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    const tokens = term.split(/\s+/);
    return items
      .map((item) => {
        const haystack =
          `${item.title} ${item.subtitle ?? ""} ${item.section} ${item.keywords ?? ""}`.toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (!haystack.includes(token)) return { item, score: -1 };
          if (item.title.toLowerCase().startsWith(token)) score += 3;
          else if (item.title.toLowerCase().includes(token)) score += 2;
          else score += 1;
        }
        return { item, score };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const grouped = useMemo(() => {
    const groups: Array<{ section: string; items: CommandItem[] }> = [];
    for (const item of filtered) {
      const existing = groups.find((group) => group.section === item.section);
      if (existing) existing.items.push(item);
      else groups.push({ section: item.section, items: [item] });
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item: CommandItem) => {
    onClose();
    window.setTimeout(item.onRun, 80);
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[97] flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh]">
          <motion.button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 460, damping: 36, mass: 0.8 }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/90 bg-surface/95 shadow-[0_30px_90px_rgba(0,0,0,.5)] backdrop-blur-2xl"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/80 to-transparent" />
            <div className="flex items-center gap-3 border-b border-border/70 px-4">
              <Search className="h-4 w-4 shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) =>
                      filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length,
                    );
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const item = filtered[active];
                    if (item) run(item);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                  }
                }}
                placeholder={placeholder}
                className="h-14 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
                aria-label="Command search"
              />
              <kbd className="hidden shrink-0 sm:inline-flex">ESC</kbd>
            </div>

            <div ref={listRef} className="max-h-[min(56vh,460px)] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <Sparkles className="h-5 w-5 text-faint" />
                  <p className="text-sm font-medium text-ink">Nothing matches “{query}”</p>
                  <p className="text-[11px] text-muted">Try a folder name, a sender or an action.</p>
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.section} className="mb-1">
                    <p className="px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">
                      {group.section}
                    </p>
                    {group.items.map((item) => {
                      const index = filtered.indexOf(item);
                      const isActive = index === active;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-command-index={index}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => run(item)}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                            isActive ? "bg-raised/90" : "hover:bg-raised/50",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                              isActive
                                ? "border-accent/30 bg-accent/15 text-accent2"
                                : "border-border/70 bg-canvas/60 text-muted",
                            )}
                          >
                            {item.icon ?? <ArrowUpRight className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium text-ink">
                              {item.title}
                            </span>
                            {item.subtitle && (
                              <span className="block truncate text-[10.5px] text-faint">
                                {item.subtitle}
                              </span>
                            )}
                          </span>
                          {item.shortcut && (
                            <kbd className="hidden shrink-0 opacity-70 group-hover:opacity-100 sm:inline-flex">
                              {item.shortcut}
                            </kbd>
                          )}
                          {isActive && (
                            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent2" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-border/60 px-4 py-2.5 text-[9.5px] text-faint">
              <span className="inline-flex items-center gap-1">
                <kbd>⌘/Ctrl</kbd>
                <kbd>K</kbd>
                toggle
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                navigate
              </span>
              <span className="ml-auto inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                private on this device
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
