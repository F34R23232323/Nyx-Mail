"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  Mail,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { AliasDTO } from "@nyxmail/shared";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { exportEmlZip, exportMbox } from "@/lib/client/export";
import { formatFullDate } from "@/lib/client/utils";

export function AccountTab() {
  const { user, setUser, refreshUser } = useAuth();
  const { bundle } = useCrypto();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [recoveryEmail, setRecoveryEmail] = useState(user?.recoveryEmail ?? "");
  const [signatureText, setSignatureText] = useState(user?.signatureText ?? "");
  const [signatureHtml, setSignatureHtml] = useState(user?.signatureHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [aliases, setAliases] = useState<AliasDTO[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [aliasBusy, setAliasBusy] = useState(false);
  const [newPrimaryEmail, setNewPrimaryEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [aliasDomains, setAliasDomains] = useState<string[]>([]);
  const [aliasDomain, setAliasDomain] = useState("");
  const [catchAllDomains, setCatchAllDomains] = useState<string[]>([]);
  const [exporting, setExporting] = useState<"mbox" | "zip" | null>(null);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });

  const domain = useMemo(() => user?.email.split("@")[1] ?? "", [user?.email]);

  const loadAliases = async () => {
    const [aliasData, domainData] = await Promise.all([
      apiFetch<{ aliases: AliasDTO[] }>("/api/v1/aliases").catch(() => ({ aliases: [] })),
      apiFetch<{ domains: string[]; primaryDomain: string; catchAllDomains: string[] }>("/api/v1/domains").catch(
        () => ({ domains: [], primaryDomain: "", catchAllDomains: [] }),
      ),
    ]);
    setAliases(aliasData.aliases);
    setAliasDomains(domainData.domains);
    setCatchAllDomains(domainData.catchAllDomains);
    setAliasDomain((current) => current || domainData.primaryDomain || domainData.domains[0] || "");
  };

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setRecoveryEmail(user.recoveryEmail ?? "");
      setSignatureText(user.signatureText ?? "");
      setSignatureHtml(user.signatureHtml ?? "");
    }
  }, [user]);

  useEffect(() => {
    void loadAliases();
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetch<{ user: typeof user }>("/api/v1/account", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim(),
          recoveryEmail: recoveryEmail.trim() || null,
          signatureText: signatureText.trim() ? signatureText : null,
          signatureHtml: signatureHtml.trim() ? signatureHtml : null,
        }),
      });
      if (data.user) setUser(data.user);
      toast({ title: "Account settings saved", tone: "success" });
    } catch (caught) {
      toast({
        title: "Settings could not be saved",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const changePrimaryEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newPrimaryEmail.trim()) return;
    setEmailBusy(true);
    try {
      const data = await apiFetch<{ user: typeof user; oldEmailAlias: boolean }>("/api/v1/account/email", {
        method: "POST",
        body: JSON.stringify({
          email: newPrimaryEmail.trim(),
          password: emailPassword,
          code: emailCode.trim(),
        }),
      });
      if (data.user) setUser(data.user);
      setNewPrimaryEmail("");
      setEmailPassword("");
      setEmailCode("");
      await loadAliases();
      toast({
        title: "Primary email updated",
        description: data.oldEmailAlias
          ? "Your old address was kept as an alias so existing mail still arrives."
          : "Other signed-in devices were signed out.",
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Primary email could not be changed",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setEmailBusy(false);
    }
  };

  const addAlias = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newAlias.trim()) return;
    setAliasBusy(true);
    try {
      const address = newAlias.includes("@")
        ? newAlias.trim()
        : `${newAlias.trim()}@${aliasDomain || domain}`;
      const data = await apiFetch<{ alias: AliasDTO }>("/api/v1/aliases", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      setAliases((current) => [...current, data.alias]);
      setNewAlias("");
      await refreshUser();
      toast({ title: "Alias created", tone: "success" });
    } catch (caught) {
      toast({
        title: "Alias could not be created",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setAliasBusy(false);
    }
  };

  const deleteAlias = async (alias: AliasDTO) => {
    await confirm({
      title: "Remove this alias?",
      description: `${alias.address} will stop receiving new mail. Existing messages stay in your mailbox.`,
      confirmLabel: "Remove alias",
      tone: "warning",
      icon: <Trash2 className="h-5 w-5" />,
      details: [{ label: "Alias", value: alias.address }],
      onConfirm: async () => {
        try {
          await apiFetch(`/api/v1/aliases/${alias.id}`, { method: "DELETE" });
          setAliases((current) => current.filter((item) => item.id !== alias.id));
          toast({ title: "Alias removed", tone: "success" });
        } catch {
          toast({ title: "Could not remove alias", tone: "error" });
        }
      },
    });
  };

  const runExport = async (format: "mbox" | "zip") => {
    if (!bundle || !user) return;
    setExporting(format);
    setExportProgress({ done: 0, total: 0 });
    try {
      if (format === "mbox") await exportMbox(bundle, (done, total) => setExportProgress({ done, total }));
      else await exportEmlZip(bundle, (done, total) => setExportProgress({ done, total }));
      toast({ title: "Export ready", description: "The decrypted archive was saved to your device.", tone: "success" });
    } catch {
      toast({ title: "Export failed", description: "Some messages may use an older key.", tone: "error" });
    } finally {
      setExporting(null);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Profile</h2>
            <p className="mt-0.5 text-[11px] text-muted">Visible on outgoing mail. Metadata is not encrypted.</p>
          </div>
          <span className="chip text-[10px]">
            <Mail className="h-3 w-3" /> {user.email}
          </span>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              required
            />
            <Input
              label="Recovery email"
              type="email"
              value={recoveryEmail}
              onChange={(event) => setRecoveryEmail(event.target.value)}
              placeholder="not used for decryption"
            />
          </div>
          <div>
            <p className="label">Signature</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <Textarea
                aria-label="Plain text signature"
                placeholder="Plain text signature"
                value={signatureText}
                onChange={(event) => setSignatureText(event.target.value)}
                className="min-h-[92px] font-mono text-[11px]"
              />
              <Textarea
                aria-label="HTML signature"
                placeholder="<p>HTML signature</p>"
                value={signatureHtml}
                onChange={(event) => setSignatureHtml(event.target.value)}
                className="min-h-[92px] font-mono text-[11px]"
              />
            </div>
            <p className="mt-1.5 text-[10px] text-faint">
              HTML is sanitized before it enters the composer. Plain text is used when writing in plain mode.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving} icon={!saving ? <Save className="h-4 w-4" /> : undefined}>
              Save changes
            </Button>
          </div>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-ink">Primary email address</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Current address: <span className="font-medium text-ink">{user.email}</span>. Changing it
            requires your password and authenticator code. The old address is kept as an alias when
            possible; other signed-in devices are signed out.
          </p>
        </div>
        <form onSubmit={changePrimaryEmail} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="New primary email"
              type="email"
              value={newPrimaryEmail}
              onChange={(event) => setNewPrimaryEmail(event.target.value)}
              placeholder={`you@${domain || "example.com"}`}
              required
            />
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={emailPassword}
              onChange={(event) => setEmailPassword(event.target.value)}
              required
            />
            <Input
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={emailCode}
              onChange={(event) => setEmailCode(event.target.value)}
              placeholder="123456"
              maxLength={8}
              required
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={emailBusy}>
              Change primary email
            </Button>
          </div>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-ink">Aliases</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            Receive mail on every active alias and choose it as your From address. Maximum 10.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/10">
              <Check className="h-3 w-3 text-success" />
            </span>
            <span className="flex-1 text-xs text-ink">{user.email}</span>
            <span className="text-[9px] uppercase tracking-wider text-faint">primary</span>
          </div>
          {aliases.map((alias) => (
            <div key={alias.id} className="flex items-center gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5">
              <span className="h-2 w-2 rounded-full bg-accent2" />
              <span className="flex-1 text-xs text-ink">{alias.address}</span>
              <button
                type="button"
                onClick={() => void deleteAlias(alias)}
                className="icon-btn h-7 w-7"
                aria-label={`Delete alias ${alias.address}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        {catchAllDomains.length > 0 && (
          <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.05] px-3 py-2 text-[10.5px] leading-relaxed text-muted">
            <span className="font-medium text-accent2">Catch-all active:</span>{" "}
            {catchAllDomains.map((item) => `@${item}`).join(", ")}. Unclaimed addresses are delivered to the
            configured catch-all mailbox. Create an alias below if you want to send from a specific address.
          </div>
        )}
        <form onSubmit={addAlias} className="mt-3 flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Input
              aria-label="New alias"
              value={newAlias}
              onChange={(event) => setNewAlias(event.target.value)}
              placeholder="hello"
            />
          </div>
          {aliasDomains.length > 0 && (
            <Select
              className="min-w-[140px] flex-none"
              panelWidth={220}
              ariaLabel="Alias domain"
              value={aliasDomain}
              onChange={setAliasDomain}
              options={aliasDomains.map((item) => ({
                value: item,
                label: `@${item}`,
              }))}
            />
          )}
          <Button type="submit" variant="secondary" loading={aliasBusy} icon={<Plus className="h-3.5 w-3.5" />}>
            Add alias
          </Button>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-ink">Export mailbox</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Export happens entirely in your browser: messages and attachments are decrypted locally, then
            downloaded as standard mbox or per-message EML files. Up to 5,000 recent messages per export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={exporting === "mbox"}
            disabled={Boolean(exporting)}
            onClick={() => void runExport("mbox")}
            icon={<Download className="h-4 w-4" />}
          >
            Download .mbox
          </Button>
          <Button
            variant="secondary"
            loading={exporting === "zip"}
            disabled={Boolean(exporting)}
            onClick={() => void runExport("zip")}
            icon={<Download className="h-4 w-4" />}
          >
            Download .eml zip
          </Button>
        </div>
        {exporting && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${exportProgress.total ? Math.max(4, (exportProgress.done / exportProgress.total) * 100) : 4}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-faint">
              Decrypting {exportProgress.done} / {exportProgress.total || "…"} messages
            </p>
          </div>
        )}
        <p className="mt-4 text-[10px] text-faint">
          Account created {formatFullDate(user.createdAt)} · storage {user.storageUsedBytes.toLocaleString()} bytes used.
        </p>
      </section>
    </div>
  );
}
