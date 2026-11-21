"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { AliasDTO } from "@nyxmail/shared";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useToast } from "@/lib/client/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { cn, copyText, downloadText, relativeTime } from "@/lib/client/utils";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  purpose: string;
  configured: boolean;
  providerSide?: boolean;
}

interface DomainSetup {
  domain: string;
  isPrimary: boolean;
  isSignupDomain: boolean;
  catchAll: boolean;
  records: DnsRecord[];
  zoneFile: string;
}

interface DnsSetup {
  hostname: string;
  dkimSelector: string;
  ipv4: string | null;
  ipv6: string | null;
  domains: DomainSetup[];
  localDomains: string[];
  notes: string[];
}

type DnsRecordCheckStatus = "ok" | "missing" | "mismatch" | "error" | "not_configured";

interface DnsRecordCheck {
  type: string;
  name: string;
  expected: string;
  actual: string[];
  status: DnsRecordCheckStatus;
  detail?: string;
}

interface DomainDnsCheck {
  domain: string;
  status: "ok" | "warning" | "error";
  checkedAt: string;
  records: DnsRecordCheck[];
}

interface DnsCheckResponse {
  checkedAt: string;
  provider?: string;
  domains: DomainDnsCheck[];
}

interface DomainEntry {
  domain: string;
  isPrimary: boolean;
  allowSignup: boolean;
  catchAllAddress: string | null;
  dkimConfigured: boolean;
  dkimSelector: string | null;
  fromEnvironment: boolean;
  managed: boolean;
  canRemove: boolean;
}

interface DomainsResponse {
  primaryDomain: string;
  domains: string[];
  signupDomains: string[];
  catchAllDomains: string[];
  canManage: boolean;
  entries: DomainEntry[];
}

const ADD_DOMAIN_SNIPPET = `# If you run Haraka or Postfix in front of NyxMail, also accept the
# domain there (the built-in MTA and the ingest webhook read NyxMail's
# database automatically):
example.com
newdomain.tld`;

function StatusBadge({
  status,
  checking = false,
}: {
  status?: DnsRecordCheckStatus;
  checking?: boolean;
}) {
  if (!status) {
    return (
      <span className="status-pill status-pill-neutral">
        {checking ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
        {checking ? "Checking" : "Not checked"}
      </span>
    );
  }
  const meta =
    status === "ok"
      ? { label: "Verified", className: "status-pill" }
      : status === "missing" || status === "not_configured"
        ? { label: status === "missing" ? "Missing" : "Not configured", className: "status-pill status-pill-warning" }
        : { label: status === "mismatch" ? "Mismatch" : "Lookup failed", className: "status-pill status-pill-danger" };
  return (
    <span className={meta.className}>
      {status === "ok" ? <Check className="h-2.5 w-2.5" /> : <TriangleAlert className="h-2.5 w-2.5" />}
      {meta.label}
    </span>
  );
}

function RecordRow({
  record,
  check,
  checking,
}: {
  record: DnsRecord;
  check?: DnsRecordCheck;
  checking: boolean;
}) {
  const { toast } = useToast();
  return (
    <div className="grid gap-2 border-t border-border/60 px-3 py-3 first:border-t-0 sm:grid-cols-[64px_180px_1fr_auto] sm:items-start">
      <span className="inline-flex w-fit rounded border border-border/80 bg-canvas px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-accent2">
        {record.type}
      </span>
      <div>
        <code className="break-all font-mono text-[10.5px] text-ink">{record.name || "@"}</code>
        <p className="mt-0.5 text-[9px] text-faint">TTL {record.ttl}</p>
      </div>
      <div className="min-w-0">
        {record.configured ? (
          <code className="break-all font-mono text-[10.5px] leading-relaxed text-muted">{record.value}</code>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning/[0.06] px-2 py-1 text-[10px] text-warning">
            <TriangleAlert className="h-3 w-3" />
            Not configured — {record.purpose}
          </span>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={check?.status} checking={checking} />
          {check?.status === "ok" && check.actual.length > 0 && (
            <span className="text-[9px] text-faint">Public DNS matches</span>
          )}
        </div>
        {check && check.status !== "ok" && check.actual.length > 0 && (
          <p className="mt-1 line-clamp-2 break-all font-mono text-[9px] leading-relaxed text-muted">
            Published: {check.actual.join(" · ")}
          </p>
        )}
        {check?.detail && check.status !== "not_configured" && (
          <p className="mt-1 text-[9px] leading-relaxed text-faint">{check.detail}</p>
        )}
        {record.configured && <p className="mt-1 text-[9px] leading-relaxed text-faint">{record.purpose}</p>}
        {record.providerSide && (
          <p className="mt-1 text-[9px] text-warning">Set this at your VPS/IP provider, not at your DNS zone host.</p>
        )}
      </div>
      <button
        type="button"
        className="icon-btn h-8 w-8 justify-self-start"
        disabled={!record.configured || !record.value}
        onClick={async () => {
          await copyText(record.value);
          toast({ title: `${record.type} record copied`, tone: "success" });
        }}
        aria-label={`Copy ${record.type} record ${record.name}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function recordFqdn(domain: string, record: DnsRecord): string {
  if (record.type === "A" || record.type === "AAAA" || record.type === "PTR") return record.name;
  if (record.name === "@") return domain;
  return `${record.name}.${domain}`;
}

function recordCheckFor(domain: string, record: DnsRecord, domainCheck?: DomainDnsCheck) {
  const fqdn = recordFqdn(domain, record);
  return domainCheck?.records.find((item) => item.type === record.type && item.name === fqdn);
}

export function DomainsTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [setup, setSetup] = useState<DnsSetup | null>(null);
  const [directory, setDirectory] = useState<DomainsResponse | null>(null);
  const [check, setCheck] = useState<DnsCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aliases, setAliases] = useState<AliasDTO[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; entry: DomainEntry | null } | null>(null);
  const [formDomain, setFormDomain] = useState("");
  const [formSignup, setFormSignup] = useState(false);
  const [formCatchAll, setFormCatchAll] = useState("");
  const [formDkim, setFormDkim] = useState(true);
  const [saving, setSaving] = useState(false);

  const checkDns = useCallback(
    async (quiet = false) => {
      setChecking(true);
      setCheckError(null);
      try {
        const data = await apiFetch<DnsCheckResponse>("/api/v1/domains/dns/status");
        setCheck(data);
      } catch {
        const message = "Could not query public DNS. Try again in a moment.";
        setCheckError(message);
        if (!quiet) {
          toast({ title: "DNS check failed", description: message, tone: "error" });
        }
      } finally {
        setChecking(false);
      }
    },
    [toast],
  );

  const load = useCallback(
    async (quiet = false) => {
      try {
        const [data, aliasData, domainData] = await Promise.all([
          apiFetch<DnsSetup>("/api/v1/domains/dns"),
          apiFetch<{ aliases: AliasDTO[] }>("/api/v1/aliases").catch(() => ({ aliases: [] })),
          apiFetch<DomainsResponse>("/api/v1/domains").catch(() => null),
        ]);
        setSetup(data);
        setAliases(aliasData.aliases);
        if (domainData) setDirectory(domainData);
        void checkDns(true);
      } catch (caught) {
        if (!quiet) {
          toast({
            title: "Could not load domain records",
            description: caught instanceof ApiClientError ? caught.message : undefined,
            tone: "error",
          });
        }
      }
    },
    [checkDns, toast],
  );

  useEffect(() => {
    void load(true).finally(() => setLoading(false));
  }, [load]);

  const canManage = Boolean(directory?.canManage);
  const entryFor = (domain: string) => directory?.entries.find((entry) => entry.domain === domain);

  function openAdd() {
    setEditor({ mode: "add", entry: null });
    setFormDomain("");
    setFormSignup(false);
    setFormCatchAll(user?.email ?? "");
    setFormDkim(true);
  }

  function openEdit(entry: DomainEntry) {
    setEditor({ mode: "edit", entry });
    setFormDomain(entry.domain);
    setFormSignup(entry.allowSignup);
    setFormCatchAll(entry.catchAllAddress ?? "");
    setFormDkim(false);
  }

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.mode === "add") {
        await apiFetch("/api/v1/domains", {
          method: "POST",
          body: JSON.stringify({
            domain: formDomain.trim(),
            allowSignup: formSignup,
            catchAllAddress: formCatchAll.trim() || null,
            generateDkim: formDkim,
          }),
        });
        toast({
          title: "Domain added",
          description: formDkim
            ? "A DKIM key was generated. Publish the records shown below."
            : "Publish the DNS records shown below, then receive mail.",
          tone: "success",
        });
      } else if (editor.entry) {
        await apiFetch(`/api/v1/domains/${encodeURIComponent(editor.entry.domain)}`, {
          method: "PATCH",
          body: JSON.stringify({
            allowSignup: formSignup,
            catchAllAddress: formCatchAll.trim() || null,
            regenerateDkim: formDkim || undefined,
          }),
        });
        toast({
          title: "Domain settings saved",
          description: formDkim ? "A new DKIM key was generated. Publish the new TXT record." : undefined,
          tone: "success",
        });
      }
      setEditor(null);
      await load();
    } catch (caught) {
      toast({
        title: editor.mode === "add" ? "Domain could not be added" : "Domain could not be updated",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeDomain(entry: DomainEntry) {
    await confirm({
      title: `Remove ${entry.domain}?`,
      description:
        "Existing addresses on this domain will stop receiving new mail. DNS records are left untouched.",
      confirmLabel: "Remove domain",
      tone: "danger",
      icon: <Globe2 className="h-5 w-5" />,
      details: [{ label: "Domain", value: entry.domain }],
      onConfirm: async () => {
        try {
          await apiFetch(`/api/v1/domains/${encodeURIComponent(entry.domain)}`, { method: "DELETE" });
          toast({ title: "Domain removed", tone: "success" });
          await load();
        } catch (caught) {
          toast({
            title: "Domain could not be removed",
            description: caught instanceof ApiClientError ? caught.message : undefined,
            tone: "error",
          });
        }
      },
    });
  }

  const aliasCount = (domain: string) =>
    aliases.filter((alias) => alias.address.toLowerCase().endsWith(`@${domain.toLowerCase()}`)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[11px] text-faint">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading domain records…
      </div>
    );
  }

  const domains = setup?.domains ?? [];
  const recordKinds: Array<{ label: string; match: (record: DnsRecord) => boolean }> = [
    { label: "MX", match: (record) => record.type === "MX" },
    { label: "SPF", match: (record) => record.type === "TXT" && /spf/i.test(record.purpose) },
    { label: "DKIM", match: (record) => record.type === "TXT" && /dkim/i.test(record.purpose) },
    { label: "DMARC", match: (record) => record.type === "TXT" && /dmarc/i.test(record.purpose) },
  ];

  function toggleDomain(domain: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function openAdvancedDns() {
    const section = document.getElementById("advanced-dns");
    section?.scrollIntoView({ behavior: "smooth" });
    const details = section?.querySelector("details");
    if (details) details.open = true;
  }

  return (
    <div className="space-y-12">
      <section>
        <button
          type="button"
          onClick={openAdvancedDns}
          className="mb-4 inline-block text-[12px] text-accent2 underline decoration-accent2/40 underline-offset-2 hover:decoration-accent2"
        >
          Learn more
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-9 px-4 text-[13px]"
            onClick={openAdd}
            disabled={!canManage}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add domain
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-9 px-4 text-[13px]"
            onClick={() => void checkDns()}
            disabled={checking}
          >
            {checking ? "Refreshing…" : "Refresh status"}
          </Button>
          {!canManage && (
            <p className="text-[10.5px] text-faint">Only the instance administrator can add domains.</p>
          )}
          {checkError && <p className="text-[10.5px] text-danger">{checkError}</p>}
        </div>

        <div className="mt-10 border-y border-border/80">
          <div className="hidden grid-cols-[minmax(160px,0.9fr)_minmax(280px,1.3fr)_auto] items-center gap-4 px-1 py-2.5 text-[11.5px] font-semibold text-ink sm:grid">
            <span>Domain</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {domains.map((domain) => {
            const domainCheck = check?.domains.find((item) => item.domain === domain.domain);
            const addresses = aliasCount(domain.domain);
            const isExpanded = expanded.has(domain.domain);
            const status = domainCheck?.status;
            const entry = entryFor(domain.domain);
            const rows = recordKinds
              .map((kind) => {
                const record = domain.records.find(kind.match);
                if (!record) return null;
                return { label: kind.label, record, check: recordCheckFor(domain.domain, record, domainCheck) };
              })
              .filter((item): item is { label: string; record: DnsRecord; check: DnsRecordCheck | undefined } => Boolean(item));

            return (
              <div key={domain.domain} className="border-t border-border/70">
                <div className="grid items-start gap-3 px-1 py-[18px] sm:grid-cols-[minmax(160px,0.9fr)_minmax(280px,1.3fr)_auto] sm:items-center sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    {status === "ok" ? (
                      <Check className="h-4 w-4 shrink-0 text-mint" />
                    ) : status === "error" ? (
                      <TriangleAlert className="h-4 w-4 shrink-0 text-danger" />
                    ) : status === "warning" ? (
                      <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-faint/60" />
                    )}
                    <span className="truncate text-[13px] font-medium text-ink">{domain.domain}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        "status-pill",
                        status === "ok"
                          ? ""
                          : status === "error"
                            ? "status-pill-danger"
                            : status === "warning"
                              ? "status-pill-warning"
                              : "status-pill-neutral",
                      )}
                    >
                      {status === "ok" ? "Verified" : status === "error" ? "DNS issues" : status === "warning" ? "Needs config" : "Unverified"}
                    </span>
                    <span className={cn("status-pill", addresses === 0 ? "status-pill-warning" : "status-pill")}>
                      {addresses} {addresses === 1 ? "address" : "addresses"}
                    </span>
                    {rows.map((row) =>
                      row.check?.status === "ok" ? (
                        <span key={row.label} className="status-pill">
                          {row.label}
                        </span>
                      ) : (
                        <span
                          key={row.label}
                          className={cn(
                            "status-pill",
                            row.check?.status === "missing" || row.check?.status === "not_configured"
                              ? "status-pill-warning"
                              : row.check?.status
                                ? "status-pill-danger"
                                : "status-pill-neutral",
                          )}
                        >
                          {row.label}
                        </span>
                      ),
                    )}
                    {domain.catchAll && <span className="status-pill status-pill-neutral">Catch-all</span>}
                    {domain.isSignupDomain && <span className="status-pill status-pill-neutral">Signup</span>}
                    {entry?.fromEnvironment && <span className="status-pill status-pill-neutral">Environment</span>}
                  </div>

                  <div className="flex items-center justify-start gap-1.5 sm:justify-end">
                    {canManage && entry && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(entry)}
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                      >
                        Manage
                      </Button>
                    )}
                    <button
                      type="button"
                      className="flex h-9 items-center gap-1.5 rounded-md border border-border/90 px-3.5 text-[11.5px] font-medium text-ink transition-colors hover:bg-raised"
                      onClick={() => toggleDomain(domain.domain)}
                      aria-expanded={isExpanded}
                    >
                      Review
                      <ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", isExpanded && "rotate-180")} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mb-4 overflow-hidden rounded-lg border border-border/70 bg-surface">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
                      <p className="text-[11.5px] font-semibold text-ink">DNS records</p>
                      <span className="text-[10px] text-faint">
                        {domainCheck
                          ? `${domainCheck.records.filter((item) => item.status === "ok").length}/${domainCheck.records.length} verified · ${relativeTime(domainCheck.checkedAt)}`
                          : checking
                            ? "Checking public DNS…"
                            : "Live DNS not checked"}
                      </span>
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const configured = domain.records.filter((record) => record.configured && record.type !== "PTR");
                            await copyText(configured.map((record) => `${record.type}\t${record.name}\t${record.value}`).join("\n"));
                            toast({
                              title: "DNS records copied",
                              description: "Paste into your DNS provider's import or advanced editor.",
                              tone: "success",
                            });
                          }}
                          icon={<Copy className="h-3.5 w-3.5" />}
                        >
                          Copy records
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => downloadText(domain.zoneFile, `${domain.domain}.zone.txt`)}
                          icon={<Download className="h-3.5 w-3.5" />}
                        >
                          Zone file
                        </Button>
                      </div>
                    </div>
                    {domain.records.map((record) => (
                      <RecordRow
                        key={`${record.type}-${record.name}`}
                        record={record}
                        check={recordCheckFor(domain.domain, record, domainCheck)}
                        checking={checking}
                      />
                    ))}
                    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-canvas/40 px-4 py-2 text-[9px] text-faint">
                      <ShieldCheck className="h-3 w-3 text-mint" />
                      SPF, DKIM and DMARC are required for reliable delivery. PTR/rDNS is provider-side.
                      <span className="ml-auto inline-flex items-center gap-1">
                        <Check className="h-3 w-3 text-mint" /> Catch-all {domain.catchAll ? "enabled" : "off"}
                      </span>
                      {canManage && entry?.canRemove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void removeDomain(entry)}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] text-muted">
          {domains.length} / {Math.max(10, domains.length)} domains used
        </p>
      </section>

      <section>
        <h2 className="text-[23px] font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Catch-all address</h2>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted">
          If you have a custom domain with NyxMail, you can set a catch-all email address to receive messages
          sent to your domain but to an invalid email address (e.g., because of typos). Use{" "}
          <span className="font-medium text-ink">Manage</span> next to a domain to change its catch-all target.
        </p>
        <button
          type="button"
          onClick={openAdvancedDns}
          className="mt-2 inline-block text-[12px] text-accent2 underline decoration-accent2/40 underline-offset-2 hover:decoration-accent2"
        >
          Learn more
        </button>
      </section>

      <section id="advanced-dns" className="scroll-mt-20">
        <details className="group rounded-lg border border-border/70 bg-surface" open={domains.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[12.5px] font-semibold text-ink">
            <Globe2 className="h-4 w-4 text-accent2" />
            Advanced DNS configuration
            <ChevronDown className="ml-auto h-4 w-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-4 py-4">
            <p className="text-[11.5px] leading-relaxed text-muted">
              Domains added here are stored in the database and read immediately by the web app, worker and
              built-in MTA. Publish the records this page generates, then send a test message. Mail host:{" "}
              <code className="font-mono text-ink">{setup?.hostname}</code>.
            </p>
            <div className="relative mt-4">
              <pre className="overflow-x-auto rounded-lg border border-border bg-canvas p-4 font-mono text-[10.5px] leading-6 text-muted">
                {ADD_DOMAIN_SNIPPET}
              </pre>
              <button
                type="button"
                className="absolute right-2 top-2 rounded-md border border-border bg-raised p-1.5 text-muted hover:text-ink"
                aria-label="Copy domain configuration"
                onClick={async () => {
                  await copyText(ADD_DOMAIN_SNIPPET);
                  toast({ title: "Configuration copied", tone: "success" });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            {setup?.localDomains && setup.localDomains.length > 0 && (
              <p className="mt-3 text-[10px] leading-relaxed text-faint">
                Local-only domains do not need public DNS:{" "}
                {setup.localDomains.map((domain) => (
                  <code key={domain} className="mr-1 font-mono text-muted">
                    {domain}
                  </code>
                ))}
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-canvas/50 p-3">
                <p className="text-[10px] font-semibold text-ink">MX checklist</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                  MX must point at <code className="font-mono text-ink">{setup?.hostname}</code>. That hostname
                  must have A/AAAA records and accept SMTP on port 25 with TLS.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-canvas/50 p-3">
                <p className="text-[10px] font-semibold text-ink">DKIM selector</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                  Selector <code className="font-mono text-ink">{setup?.dkimSelector}</code>. The private key is
                  encrypted in the NyxMail database; only the public key is published at{" "}
                  <code className="font-mono text-ink">{setup?.dkimSelector}._domainkey</code>.
                </p>
              </div>
            </div>
            {setup?.notes && setup.notes.length > 0 && (
              <ul className="mt-4 space-y-2">
                {setup.notes.map((note) => (
                  <li key={note} className="flex gap-2 text-[10.5px] leading-relaxed text-muted">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent2" />
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>

      <Modal
        open={Boolean(editor)}
        onClose={() => {
          if (!saving) setEditor(null);
        }}
        title={editor?.mode === "add" ? "Add a domain" : `Manage ${editor?.entry?.domain ?? "domain"}`}
        description={
          editor?.mode === "add"
            ? "NyxMail will accept mail for this domain immediately. Publish the MX, SPF, DKIM and DMARC records after adding it."
            : "Control signups, route unclaimed addresses to a catch-all mailbox, or rotate the DKIM key."
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditor(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" form="domain-editor-form" loading={saving}>
              {editor?.mode === "add" ? "Add domain" : "Save changes"}
            </Button>
          </div>
        }
      >
        <form id="domain-editor-form" onSubmit={saveEditor} className="space-y-5 px-5 py-4">
          <Input
            label="Domain"
            value={formDomain}
            onChange={(event) => setFormDomain(event.target.value)}
            placeholder="example.com"
            autoComplete="off"
            spellCheck={false}
            disabled={editor?.mode === "edit"}
            hint={
              editor?.mode === "edit"
                ? "The domain name cannot be changed. Remove it and add a new one instead."
                : "Use the domain itself, not the mail hostname (e.g. example.com, not mail.example.com)."
            }
            required
          />

          <Input
            label="Catch-all address (optional)"
            value={formCatchAll}
            onChange={(event) => setFormCatchAll(event.target.value)}
            placeholder={user?.email ? `you@${user.email.split("@")[1] ?? "example.com"}` : "you@example.com"}
            autoComplete="off"
            spellCheck={false}
            hint="Unclaimed addresses on this domain are delivered here. Leave empty to reject unknown recipients. The target must already be a mailbox or active alias."
          />

          <div className="space-y-3 rounded-lg border border-border/70 bg-canvas/40 p-3.5">
            <label className="flex items-start gap-2 text-[11.5px] text-muted">
              <input
                type="checkbox"
                checked={formSignup}
                onChange={(event) => setFormSignup(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[#6D4AFF]"
              />
              <span>
                Allow new account signups on this domain
                <span className="mt-0.5 block text-[10px] text-faint">
                  Leave this off to keep public registration limited to your primary domain.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[11.5px] text-muted">
              <input
                type="checkbox"
                checked={formDkim}
                onChange={(event) => setFormDkim(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[#6D4AFF]"
              />
              <span>
                {editor?.mode === "add" ? "Generate a DKIM key automatically" : "Rotate the DKIM key now"}
                <span className="mt-0.5 block text-[10px] text-faint">
                  {editor?.mode === "add"
                    ? "Recommended. The private key is encrypted in the database and used to sign outbound mail."
                    : "Publish the new public key before mail is sent, or leave this off to keep the current key."}
                </span>
              </span>
            </label>
          </div>

          {editor?.mode === "edit" && editor.entry?.fromEnvironment && (
            <p className="rounded-lg border border-warning/20 bg-warning/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-warning">
              This domain is also listed in the server environment. Those settings remain active until you remove
              the domain from <code className="font-mono">MAIL_DOMAINS</code> /{" "}
              <code className="font-mono">CATCH_ALL_MAP</code>.
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
