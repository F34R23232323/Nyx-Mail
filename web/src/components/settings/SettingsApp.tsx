"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Filter,
  Globe2,
  KeyRound,
  LogOut,
  Palette,
  Search,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { useToast } from "@/lib/client/toast";
import { Logo } from "@/components/ui/Logo";
import { UnlockGate } from "@/components/auth/UnlockGate";
import { cn, formatBytes } from "@/lib/client/utils";
import { AccountTab } from "./AccountTab";
import { SecurityTab } from "./SecurityTab";
import { ImportsTab } from "./ImportsTab";
import { AppearanceTab } from "./AppearanceTab";
import { KeysTab } from "./KeysTab";
import { FiltersTab } from "./FiltersTab";
import { DomainsTab } from "./DomainsTab";

type TabId = "account" | "appearance" | "security" | "filters" | "keys" | "imports" | "domains";

interface SettingsItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: Array<{ heading: string | null; items: SettingsItem[] }> = [
  {
    heading: null,
    items: [
      { id: "account", label: "Account and password", icon: UserRound },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "security", label: "Security and privacy", icon: ShieldCheck },
    ],
  },
  {
    heading: "NyxMail",
    items: [
      { id: "filters", label: "Filters", icon: Filter },
      { id: "keys", label: "Encryption and keys", icon: KeyRound },
      { id: "imports", label: "Import via Easy Switch", icon: Download },
    ],
  },
  {
    heading: "Organization",
    items: [{ id: "domains", label: "Domain names", icon: Globe2 }],
  },
];

const TABS = SECTIONS.flatMap((section) => section.items);

const META: Record<TabId, { title: string; description: string }> = {
  account: {
    title: "Account and password",
    description: "Manage your display name, primary address, recovery details and mail signature.",
  },
  appearance: {
    title: "Appearance",
    description: "Choose how NyxMail looks and which privacy defaults apply when you read mail.",
  },
  security: {
    title: "Security and privacy",
    description: "Protect your account with a strong password, two-factor authentication and passkeys.",
  },
  filters: {
    title: "Filters",
    description: "Create rules that sort, label and organise incoming mail before it reaches your inbox.",
  },
  keys: {
    title: "Encryption and keys",
    description: "Your keys are generated in the browser and never leave this device unencrypted.",
  },
  imports: {
    title: "Import via Easy Switch",
    description: "Bring your existing mail and contacts over from another provider.",
  },
  domains: {
    title: "Domain names",
    description: "Connect your custom domain to NyxMail to set up custom email addresses (e.g. you@your-company.com). Our wizard will guide you through the process.",
  },
};

export function SettingsApp() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading, logout } = useAuth();
  const { ready } = useCrypto();
  const { toast } = useToast();
  const requested = params.get("tab");
  const tab: TabId = TABS.some((item) => item.id === requested) ? (requested as TabId) : "account";
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/settings")}`);
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    const error = params.get("gmailError");
    const connected = params.get("gmailConnected");
    if (error) {
      toast({ title: "Gmail connection failed", description: error, tone: "error" });
    } else if (connected) {
      toast({
        title: "Gmail connected",
        description: "The import job is queued. Keep the worker running to make progress.",
        tone: "success",
      });
    }
    if (error || connected) {
      router.replace(`/settings?tab=imports`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const changeTab = (next: TabId) => {
    setSearch("");
    router.replace(`/settings?tab=${next}`);
  };

  const visibleSections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => item.id !== "domains" || Boolean(user?.isAdmin)),
      })).filter((section) => section.items.length > 0),
    [user?.isAdmin],
  );
  const visibleTabs = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections],
  );

  const filteredSections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return visibleSections;
    return visibleSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.label.toLowerCase().includes(term)),
      }))
      .filter((section) => section.items.length > 0);
  }, [search, visibleSections]);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <Logo />
          <p className="text-[11px] text-faint">Loading settings…</p>
        </div>
      </div>
    );
  }
  if (!ready) return <UnlockGate />;

  const meta = META[tab];

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas">
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border/70 bg-canvas lg:flex" aria-label="Settings navigation">
        <div className="flex h-14 shrink-0 items-center px-4">
          <Link href="/mail" aria-label="NyxMail">
            <Logo />
          </Link>
        </div>

        <div className="px-2 pb-3 pt-1">
          <Link
            href="/mail"
            className="flex h-9 items-center gap-2 rounded-md bg-raised px-3 text-[13px] font-medium text-ink transition-colors hover:bg-raised/80"
          >
            <ArrowLeft className="h-4 w-4" />
            Inbox
          </Link>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 no-scrollbar">
          {filteredSections.map((section, index) => (
            <div key={section.heading ?? `section-${index}`} className={cn(index > 0 && "mt-5")}>
              {section.heading && (
                <p className="mb-1 px-3 text-[11px] font-medium text-faint">{section.heading}</p>
              )}
              <div className="space-y-px">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => changeTab(item.id)}
                      aria-current={tab === item.id ? "page" : undefined}
                      className="settings-nav-item"
                      data-active={tab === item.id}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {filteredSections.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-faint">No matching settings</p>
          )}
        </nav>

        <div className="shrink-0 border-t border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 text-[9.5px] text-faint">
            <span className="tabular-nums">
              {formatBytes(user.storageUsedBytes)} / {formatBytes(user.storageLimitBytes)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="rounded p-0.5 text-faint transition-colors hover:text-ink"
                onClick={() => void logout()}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-3 w-3" />
              </button>
              <span className="opacity-60">1.0.0</span>
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-mint"
              style={{ width: `${Math.max(1, Math.min(100, (user.storageUsedBytes / Math.max(1, user.storageLimitBytes)) * 100))}%` }}
            />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="topbar">
          <Link href="/mail" className="icon-btn -ml-1 h-8 w-8 lg:hidden" aria-label="Back to inbox">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="relative w-full max-w-[500px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = filteredSections.flatMap((section) => section.items)[0];
                  if (first) changeTab(first.id);
                }
              }}
              placeholder="Search settings"
              aria-label="Search settings"
              className="h-9 w-full rounded-md border border-transparent bg-raised2 pl-9 pr-9 text-[13px] text-ink outline-none transition-colors placeholder:text-faint hover:bg-raised/70 focus:border-accent/50 focus:bg-raised2"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-faint hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </header>

        <div className="shrink-0 border-b border-border/60 px-4 py-2 lg:hidden">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {visibleTabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => changeTab(item.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium",
                    tab === item.id ? "bg-raised text-ink" : "text-muted",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-[1196px] px-5 py-8 sm:px-8 lg:py-12 lg:pl-[clamp(64px,11vw,190px)] lg:pr-10">
            <header className="mb-8 border-b border-border/50 pb-6">
              <h1 className="text-[30px] font-bold tracking-[-0.025em] text-ink sm:text-[38px]">{meta.title}</h1>
              <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted">{meta.description}</p>
            </header>

            <div className="animate-in">
              {tab === "account" && <AccountTab />}
              {tab === "security" && <SecurityTab />}
              {tab === "filters" && <FiltersTab />}
              {tab === "domains" && <DomainsTab />}
              {tab === "imports" && <ImportsTab />}
              {tab === "appearance" && <AppearanceTab />}
              {tab === "keys" && <KeysTab />}
            </div>

            <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[9.5px] text-faint">
              <span>NyxMail · self-hosted encrypted webmail</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                Server stores ciphertext only
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
