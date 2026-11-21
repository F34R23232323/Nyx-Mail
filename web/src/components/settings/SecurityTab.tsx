"use client";

import { useEffect, useMemo, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Fingerprint,
  KeyRound,
  Laptop,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import type { SessionDTO } from "@nyxmail/shared";
import { createKeyEnvelope, createRecoveryKit } from "@nyxmail/crypto";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { relativeTime, downloadText, copyText } from "@/lib/client/utils";

interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  deviceType?: string | null;
  backedUp?: boolean;
}

interface FilterInfo {
  id: string;
  kind: "BLOCK" | "ALLOW";
  pattern: string;
  createdAt: string;
}

export function SecurityTab() {
  const { user, refreshUser, logout } = useAuth();
  const { bundle } = useCrypto();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [filters, setFilters] = useState<FilterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [backupCodeInput, setBackupCodeInput] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [filterKind, setFilterKind] = useState<"BLOCK" | "ALLOW">("BLOCK");
  const [filterPattern, setFilterPattern] = useState("");

  const loadSecurity = async () => {
    setLoading(true);
    try {
      const [sessionData, passkeyData, filterData] = await Promise.all([
        apiFetch<{ sessions: SessionDTO[] }>("/api/v1/sessions"),
        apiFetch<{ passkeys: PasskeyInfo[] }>("/api/v1/passkeys").catch(() => ({ passkeys: [] })),
        apiFetch<{ filters: FilterInfo[] }>("/api/v1/filters").catch(() => ({ filters: [] })),
      ]);
      setSessions(sessionData.sessions);
      setPasskeys(passkeyData.passkeys);
      setFilters(filterData.filters);
    } catch {
      toast({ title: "Could not load security settings", tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSecurity();
  }, []);

  const revokeSession = async (session: SessionDTO) => {
    await confirm({
      title: session.current ? "Sign out of this device?" : "Revoke this session?",
      description: session.current
        ? "You will need your password and authenticator to sign in again."
        : `${session.userAgent} · ${session.ip}`,
      confirmLabel: session.current ? "Sign out" : "Revoke session",
      tone: "danger",
      icon: <Laptop className="h-5 w-5" />,
      onConfirm: async () => {
        setBusy(session.id);
        try {
          const result = await apiFetch<{ current: boolean }>(`/api/v1/sessions/${session.id}`, {
            method: "DELETE",
          });
          if (result.current) {
            await logout();
            return;
          }
          setSessions((current) => current.filter((item) => item.id !== session.id));
          toast({ title: "Session revoked", tone: "success" });
        } catch {
          toast({ title: "Could not revoke session", tone: "error" });
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const addPasskey = async () => {
    setBusy("passkey-add");
    try {
      const data = await apiFetch<{ options: Record<string, unknown>; flowToken: string }>(
        "/api/v1/passkeys/options",
        { method: "POST" },
      );
      const credential = await startRegistration(
        data.options as unknown as Parameters<typeof startRegistration>[0],
      );
      await apiFetch("/api/v1/passkeys", {
        method: "POST",
        body: JSON.stringify({
          flowToken: data.flowToken,
          response: credential,
          name: window.prompt("Name this passkey", "Passkey") || "Passkey",
        }),
      });
      await Promise.all([loadSecurity(), refreshUser()]);
      toast({ title: "Passkey registered", tone: "success" });
    } catch (caught) {
      toast({
        title: "Passkey registration failed",
        description:
          caught instanceof ApiClientError
            ? caught.message
            : caught instanceof Error && caught.name === "NotAllowedError"
              ? "The passkey prompt was cancelled."
              : "Your authenticator may not support passkeys on this origin.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const deletePasskey = async (passkey: PasskeyInfo) => {
    await confirm({
      title: "Remove this passkey?",
      description: `${passkey.name} will no longer be able to unlock this account.`,
      confirmLabel: "Remove passkey",
      tone: "danger",
      icon: <Fingerprint className="h-5 w-5" />,
      details: [{ label: "Passkey", value: passkey.name }],
      onConfirm: async () => {
        setBusy(passkey.id);
        try {
          await apiFetch(`/api/v1/passkeys/${encodeURIComponent(passkey.id)}`, { method: "DELETE" });
          setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
          await refreshUser();
          toast({ title: "Passkey removed", tone: "success" });
        } catch {
          toast({ title: "Could not remove passkey", tone: "error" });
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const regenerateBackupCodes = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("backup-codes");
    try {
      const data = await apiFetch<{ backupCodes: string[] }>("/api/v1/auth/backup-codes", {
        method: "POST",
        body: JSON.stringify({ code: backupCodeInput }),
      });
      setNewBackupCodes(data.backupCodes);
      setBackupCodeInput("");
      await refreshUser();
    } catch (caught) {
      toast({
        title: "Could not regenerate codes",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bundle) return;
    if (passwordForm.next.length < 10) {
      toast({ title: "Use at least 10 characters", tone: "warning" });
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      toast({ title: "New passwords do not match", tone: "warning" });
      return;
    }
    setPasswordBusy(true);
    try {
      const envelope = await createKeyEnvelope(bundle, passwordForm.next);
      await apiFetch("/api/v1/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.current,
          newPassword: passwordForm.next,
          encryptedPrivateKey: envelope.encryptedPrivateKey,
          argonSalt: envelope.argonSalt,
        }),
      });
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast({
        title: "Password changed",
        description: "Your private key was re-encrypted. Other sessions were revoked.",
        tone: "success",
      });
      await loadSecurity();
    } catch (caught) {
      toast({
        title: "Password could not be changed",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setPasswordBusy(false);
    }
  };

  const rotateRecoveryKit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bundle) return;
    setRecoveryBusy(true);
    try {
      const kit = await createRecoveryKit(bundle);
      await apiFetch("/api/v1/auth/recovery-kit", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: recoveryPassword,
          code: recoveryCode,
          recoveryEncryptedPrivateKey: kit.encryptedPrivateKey,
          recoverySalt: kit.argonSalt,
          recoveryKeyHash: kit.recoveryKeyHash,
        }),
      });
      setRecoveryPhrase(kit.phrase);
      setRecoveryPassword("");
      setRecoveryCode("");
      toast({ title: "New recovery kit created", tone: "success" });
    } catch (caught) {
      toast({
        title: "Could not create a recovery kit",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const addFilter = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!filterPattern.trim()) return;
    setBusy("filter");
    try {
      const data = await apiFetch<{ filter: FilterInfo }>("/api/v1/filters", {
        method: "POST",
        body: JSON.stringify({ kind: filterKind, pattern: filterPattern.trim() }),
      });
      setFilters((current) => [data.filter, ...current.filter((item) => item.id !== data.filter.id)]);
      setFilterPattern("");
      toast({ title: filterKind === "BLOCK" ? "Sender blocked" : "Sender allowed", tone: "success" });
    } catch (caught) {
      toast({
        title: "Filter could not be saved",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const removeFilter = async (filter: FilterInfo) => {
    await confirm({
      title: filter.kind === "BLOCK" ? "Stop blocking this sender?" : "Stop allowing this sender?",
      description: filter.pattern,
      confirmLabel: "Remove filter",
      tone: "warning",
      icon: <Trash2 className="h-5 w-5" />,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/v1/filters/${filter.id}`, { method: "DELETE" });
          setFilters((current) => current.filter((item) => item.id !== filter.id));
        } catch {
          toast({ title: "Could not remove filter", tone: "error" });
        }
      },
    });
  };

  const downloadBackupCodes = () => {
    if (!newBackupCodes) return;
    downloadText(
      [
        "NYXMAIL ONE-TIME BACKUP CODES",
        `Account: ${user?.email}`,
        `Generated: ${new Date().toISOString()}`,
        "",
        ...newBackupCodes,
        "",
        "Each code works once. Regenerate from Settings → Security.",
      ].join("\n"),
      "nyxmail-backup-codes.txt",
    );
  };

  const downloadRecoveryKit = () => {
    if (!recoveryPhrase) return;
    downloadText(
      [
        "NYXMAIL RECOVERY KIT",
        `Account: ${user?.email}`,
        `Created: ${new Date().toISOString()}`,
        "",
        "RECOVERY PHRASE (24 words)",
        recoveryPhrase,
        "",
        "This phrase, plus access to your email and 2FA device, can re-wrap your",
        "private key if you lose your password. Store it offline. NyxMail cannot",
        "recover it for you.",
      ].join("\n"),
      "nyxmail-recovery-kit.txt",
    );
  };

  const passkeySupported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.PublicKeyCredential),
    [],
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-success/20 bg-success/[0.04] p-4">
          <div className="flex items-center gap-2 text-success">
            <ShieldCheck className="h-4 w-4" />
            <p className="text-xs font-semibold">Two-factor active</p>
          </div>
          <p className="mt-1 text-[10px] text-muted">Mandatory TOTP on every sign-in.</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-ink">
            <KeyRound className="h-4 w-4 text-accent2" />
            <p className="text-xs font-semibold">{user?.backupCodesRemaining ?? 0} backup codes</p>
          </div>
          <p className="mt-1 text-[10px] text-muted">Single-use recovery if your authenticator is lost.</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-ink">
            <Fingerprint className="h-4 w-4 text-accent2" />
            <p className="text-xs font-semibold">{passkeys.length} passkeys</p>
          </div>
          <p className="mt-1 text-[10px] text-muted">Optional phishing-resistant second factor.</p>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Change password</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
          Your private key bundle is decrypted locally, re-encrypted with a new Argon2id-derived key, and
          uploaded. The server verifies the old password but never sees the new key.
        </p>
        <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-3">
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={passwordForm.current}
            onChange={(event) => setPasswordForm((form) => ({ ...form, current: event.target.value }))}
            required
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={passwordForm.next}
            onChange={(event) => setPasswordForm((form) => ({ ...form, next: event.target.value }))}
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={passwordForm.confirm}
            onChange={(event) => setPasswordForm((form) => ({ ...form, confirm: event.target.value }))}
            required
          />
          <div className="sm:col-span-3 flex justify-end">
            <Button type="submit" loading={passwordBusy} icon={!passwordBusy ? <LockKeyhole className="h-4 w-4" /> : undefined}>
              Re-encrypt private key
            </Button>
          </div>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Recovery kit</h2>
            <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-muted">
              Generate a fresh 24-word phrase that wraps your private key independently of your password.
              The previous recovery phrase stops working immediately.
            </p>
          </div>
          <span className="chip">Argon2id + BIP-39</span>
        </div>
        <form onSubmit={rotateRecoveryKit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={recoveryPassword}
            onChange={(event) => setRecoveryPassword(event.target.value)}
            required
          />
          <Input
            label="TOTP code"
            inputMode="numeric"
            maxLength={6}
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <Button type="submit" variant="secondary" loading={recoveryBusy}>
            Generate new kit
          </Button>
        </form>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/[0.05] p-3 text-[10.5px] leading-relaxed text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          If you lose both your password and recovery kit, nobody can decrypt your archived mailbox.
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Backup codes</h2>
        <p className="mt-0.5 text-[11px] text-muted">
          {user?.backupCodesRemaining ?? 0} unused. Generating a new set invalidates all remaining codes.
        </p>
        <form onSubmit={regenerateBackupCodes} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:max-w-[220px]">
            <Input
              label="Authenticator code"
              inputMode="numeric"
              maxLength={6}
              value={backupCodeInput}
              onChange={(event) => setBackupCodeInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </div>
          <Button type="submit" variant="secondary" loading={busy === "backup-codes"}>
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </Button>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Passkeys</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              Use a platform authenticator or hardware security key as your second factor.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void addPasskey()}
            loading={busy === "passkey-add"}
            disabled={!passkeySupported}
            icon={<Plus className="h-4 w-4" />}
          >
            Add passkey
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {passkeys.length === 0 && (
            <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[11px] text-faint">
              {passkeySupported ? "No passkeys registered." : "This browser does not expose WebAuthn here."}
            </p>
          )}
          {passkeys.map((passkey) => (
            <div key={passkey.id} className="flex items-center gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent2">
                <Fingerprint className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{passkey.name}</p>
                <p className="text-[10px] text-faint">
                  Added {new Date(passkey.createdAt).toLocaleDateString()} · {passkey.deviceType || "passkey"}
                  {passkey.backedUp ? " · synced" : ""}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn h-7 w-7"
                onClick={() => void deletePasskey(passkey)}
                disabled={busy === passkey.id}
                aria-label={`Remove ${passkey.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Active sessions</h2>
            <p className="mt-0.5 text-[11px] text-muted">Refresh tokens rotate on every use. Revoke anything unfamiliar.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadSecurity()} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {sessions.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-canvas px-3 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted">
                {/mobile|iphone|android/i.test(session.userAgent) ? <Smartphone className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-ink">
                  {session.userAgent.slice(0, 80)}
                  {session.current && <span className="ml-2 chip py-0.5 text-[8px] text-success">This device</span>}
                </p>
                <p className="text-[10px] text-faint">
                  {session.ip} · last seen {relativeTime(session.lastSeenAt)} · expires {new Date(session.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-danger"
                onClick={() => void revokeSession(session)}
                disabled={busy === session.id}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Sender filters</h2>
        <p className="mt-0.5 text-[11px] text-muted">
          Per-user allow and block rules are evaluated before heuristic spell-checking. Reports from the reading pane train this list automatically.
        </p>
        <form onSubmit={addFilter} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="w-32">
            <Select
              label="Action"
              ariaLabel="Sender filter action"
              value={filterKind}
              onChange={(value) => setFilterKind(value as "BLOCK" | "ALLOW")}
              panelWidth={180}
              options={[
                { value: "BLOCK", label: "Block", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
                { value: "ALLOW", label: "Allow", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Sender or domain"
              placeholder="spam@example.com or @example.com"
              value={filterPattern}
              onChange={(event) => setFilterPattern(event.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="secondary" loading={busy === "filter"} icon={<Plus className="h-3.5 w-3.5" />}>
            Add rule
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.length === 0 && <p className="text-[11px] text-faint">No sender filters yet.</p>}
          {filters.map((filter) => (
            <span
              key={filter.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
                filter.kind === "BLOCK"
                  ? "border-danger/20 bg-danger/[0.06] text-danger"
                  : "border-success/20 bg-success/[0.06] text-success"
              }`}
            >
              {filter.kind === "BLOCK" ? "Block" : "Allow"} · {filter.pattern}
              <button type="button" onClick={() => void removeFilter(filter)} aria-label={`Remove filter ${filter.pattern}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      </section>

      <Modal
        open={Boolean(newBackupCodes)}
        onClose={() => setNewBackupCodes(null)}
        title="New backup codes"
        description="These codes are shown once. Each works a single time."
        width="sm"
      >
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-canvas p-3">
            {newBackupCodes?.map((code) => (
              <code key={code} className="rounded-lg bg-surface px-2 py-2 text-center font-mono text-[12px] text-ink">
                {code}
              </code>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={async () => {
                if (newBackupCodes) {
                  await copyText(newBackupCodes.join("\n"));
                  toast({ title: "Codes copied", tone: "success" });
                }
              }}
            >
              Copy
            </Button>
            <Button variant="secondary" className="flex-1" icon={<Download className="h-3.5 w-3.5" />} onClick={downloadBackupCodes}>
              Download
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(recoveryPhrase)}
        onClose={() => setRecoveryPhrase(null)}
        title="Your new recovery kit"
        description="This phrase will not be shown again. Store it offline."
        width="md"
      >
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/[0.06] p-3 text-[11px] leading-relaxed text-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            This replaces your previous recovery phrase. Anyone holding the old phrase can no longer use it.
          </div>
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-canvas p-3 sm:grid-cols-3">
            {recoveryPhrase?.split(" ").map((word, index) => (
              <div key={`${word}-${index}`} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5">
                <span className="w-4 text-right text-[9px] text-faint">{index + 1}</span>
                <span className="font-mono text-[11px] text-ink">{word}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={async () => {
                if (recoveryPhrase) {
                  await copyText(recoveryPhrase);
                  toast({ title: "Recovery phrase copied", tone: "success" });
                }
              }}
            >
              Copy
            </Button>
            <Button variant="secondary" className="flex-1" icon={<Download className="h-3.5 w-3.5" />} onClick={downloadRecoveryKit}>
              Download kit
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
