"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Command,
  Contact,
  Keyboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import type { UserDTO } from "@nyxmail/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { useTheme } from "@/lib/client/theme";

interface TopBarProps {
  user: UserDTO;
  query: string;
  onQueryChange: (value: string) => void;
  onQueryClear: () => void;
  onOpenCommand: () => void;
  onOpenShortcuts: () => void;
  onOpenSidebar?: () => void;
  onOpenContacts: () => void;
  onLogout: () => void;
}

export function TopBar({
  user,
  query,
  onQueryChange,
  onQueryClear,
  onOpenCommand,
  onOpenShortcuts,
  onOpenSidebar,
  onOpenContacts,
  onLogout,
}: TopBarProps) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "/" && !editable) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <header className="topbar relative" aria-label="Mailbox toolbar">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
      {onOpenSidebar && (
        <button
          type="button"
          className="icon-btn -ml-1 lg:hidden"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      <div className="group relative w-full max-w-[520px]">
        <div className="pointer-events-none absolute -inset-px rounded-lg bg-gradient-to-r from-accent/0 via-accent/40 to-brand/0 opacity-0 blur-[1px] transition-opacity duration-300 group-focus-within:opacity-100" />
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-[15px] w-[15px] -translate-y-1/2 text-faint transition-colors group-focus-within:text-accent2" />
        <input
          type="text"
          id="mail-search"
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search messages, people, attachments…"
          aria-label="Search messages"
          className="relative h-9 w-full rounded-lg border border-transparent bg-raised2 pl-9 pr-[54px] text-[13px] text-ink outline-none transition-all placeholder:text-faint hover:bg-raised/70 focus:border-accent/50 focus:bg-raised2 focus:shadow-glow"
        />
        {query ? (
          <button
            type="button"
            onClick={onQueryClear}
            className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenCommand}
            className="absolute right-1.5 top-1/2 z-10 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-border/70 bg-canvas/60 px-1.5 py-0.5 text-[9px] text-faint transition-colors hover:border-accent/40 hover:text-ink sm:flex"
            aria-label="Open command palette"
            title="Command palette"
          >
            <Command className="h-2.5 w-2.5" />
            <span>K</span>
          </button>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onOpenCommand}
          className="icon-btn hidden sm:inline-flex"
          aria-label="Open command palette"
          title="Command palette (⌘K)"
        >
          <Command className="h-[17px] w-[17px]" />
        </button>
        <Link href="/settings" className="icon-btn" aria-label="Settings" title="Settings">
          <Settings className="h-[18px] w-[18px]" />
        </Link>

        <Dropdown
          align="end"
          width={264}
          header={
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <Avatar name={user.displayName} email={user.email} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-ink">{user.displayName}</p>
                <p className="truncate text-[10px] text-muted">{user.email}</p>
              </div>
              <span className="ml-auto flex items-center gap-1 rounded-full bg-mint/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-mint">
                <span className="h-1 w-1 rounded-full bg-mint" />
                Secure
              </span>
            </div>
          }
          trigger={({ open, toggle }) => (
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg py-1 pl-1.5 pr-1 transition-colors hover:bg-raised/60"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <span className="hidden min-w-0 text-right sm:block">
                <span className="block max-w-[150px] truncate text-[12px] font-medium leading-tight text-ink">
                  {user.displayName}
                </span>
                <span className="block max-w-[150px] truncate text-[10px] leading-tight text-muted">
                  {user.email}
                </span>
              </span>
              <Avatar name={user.displayName} email={user.email} size="sm" className="h-7 w-7 text-[10px]" />
              <ChevronDown
                className={`hidden h-3.5 w-3.5 text-faint transition-transform sm:block ${open ? "rotate-180" : ""}`}
              />
            </button>
          )}
          sections={[
            {
              items: [
                {
                  key: "command",
                  label: "Command palette",
                  hint: "Search actions and conversations",
                  icon: <Command className="h-3.5 w-3.5" />,
                  trailing: <kbd>⌘K</kbd>,
                  onSelect: onOpenCommand,
                },
                {
                  key: "contacts",
                  label: "Contacts",
                  icon: <Contact className="h-3.5 w-3.5" />,
                  onSelect: onOpenContacts,
                },
                {
                  key: "shortcuts",
                  label: "Keyboard shortcuts",
                  icon: <Keyboard className="h-3.5 w-3.5" />,
                  trailing: <kbd>?</kbd>,
                  onSelect: onOpenShortcuts,
                },
                {
                  key: "settings",
                  label: "Settings",
                  icon: <Settings className="h-3.5 w-3.5" />,
                  onSelect: () => router.push("/settings"),
                },
              ],
            },
            {
              heading: "Appearance",
              items: [
                {
                  key: "theme",
                  label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
                  icon:
                    theme === "dark" ? (
                      <Sun className="h-3.5 w-3.5" />
                    ) : (
                      <Moon className="h-3.5 w-3.5" />
                    ),
                  onSelect: toggleTheme,
                },
              ],
            },
            {
              items: [
                {
                  key: "logout",
                  label: "Sign out",
                  icon: <LogOut className="h-3.5 w-3.5" />,
                  danger: true,
                  onSelect: onLogout,
                },
              ],
            },
          ]}
          footer={
            <p className="px-2.5 py-1.5 text-[9px] text-faint">
              End-to-end encrypted · keys stay on this device
            </p>
          }
        />
      </div>
    </header>
  );
}
