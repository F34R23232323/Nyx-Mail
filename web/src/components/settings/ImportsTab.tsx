"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  Clock3,
  Cloud,
  Copy,
  FileUp,
  Import,
  Loader2,
  Pause,
  Play,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ImportJobDTO, ImportStatus } from "@nyxmail/shared";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn, copyText } from "@/lib/client/utils";

const STATUS_STYLE: Record<ImportStatus, string> = {
  PENDING: "border-border bg-raised text-muted",
  RUNNING: "border-accent/25 bg-accent/10 text-accent2",
  PAUSED: "border-warning/25 bg-warning/10 text-warning",
  COMPLETED: "border-success/25 bg-success/10 text-success",
  FAILED: "border-danger/25 bg-danger/10 text-danger",
  CANCELLED: "border-border bg-raised text-faint",
};

interface GmailAccountDTO {
  id: string;
  googleEmail: string;
  enabled: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

function importSource(job: ImportJobDTO): string {
  if (job.source === "GMAIL") return "Gmail";
  if (job.source === "PROTON") {
    return String(job.meta?.mode ?? "").includes("Bridge")
      ? `Proton Bridge · ${String(job.meta?.host ?? "127.0.0.1")}`
      : `Proton export · ${String(job.meta?.filename ?? "ZIP archive")}`;
  }
  if (job.source === "IMAP") return `IMAP · ${String(job.meta?.host ?? "server")}`;
  return job.source === "MBOX" ? "mbox archive" : "EML message";
}

function eta(job: ImportJobDTO): string {
  if (job.status !== "RUNNING" || !job.startedAt || job.totalMessages <= 0 || job.progressMessages <= 0) {
    return job.status === "RUNNING" ? "calculating…" : "";
  }
  const elapsed = Math.max(1000, Date.now() - new Date(job.startedAt).getTime());
  const rate = job.progressMessages / elapsed;
  const remaining = Math.max(0, job.totalMessages - job.progressMessages);
  const ms = remaining / Math.max(rate, 1e-9);
  if (ms < 60_000) return "< 1 min left";
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)} min left`;
  return `${(ms / 3_600_000).toFixed(1)} h left`;
}

export function ImportsTab() {
  const { toast } = useToast();
  const [appOrigin, setAppOrigin] = useState("https://mail.example.com");
  const gmailRedirectUri = `${appOrigin}/api/v1/imports/gmail/callback`;

  useEffect(() => {
    setAppOrigin(window.location.origin);
  }, []);
  const [jobs, setJobs] = useState<ImportJobDTO[]>([]);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccountDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [imap, setImap] = useState({
    host: "",
    port: "993",
    secure: true,
    username: "",
    password: "",
  });
  const [imapBusy, setImapBusy] = useState(false);
  const [proton, setProton] = useState({
    host: "127.0.0.1",
    port: "1143",
    username: "",
    password: "",
  });
  const [protonBusy, setProtonBusy] = useState(false);
  const [protonZipBusy, setProtonZipBusy] = useState(false);
  const protonZipRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [data, gmail] = await Promise.all([
        apiFetch<{ imports: ImportJobDTO[] }>("/api/v1/imports"),
        apiFetch<{ accounts: GmailAccountDTO[] }>("/api/v1/imports/gmail/accounts").catch(() => ({
          accounts: [],
        })),
      ]);
      setJobs(data.imports);
      setGmailAccounts(gmail.accounts);
    } catch (caught) {
      if (!(caught instanceof ApiClientError && caught.status === 401)) {
        toast({ title: "Could not load imports", tone: "error" });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  useEffect(() => {
    const active = jobs.some((job) => ["PENDING", "RUNNING", "PAUSED"].includes(job.status));
    if (!active) return;
    const timer = setInterval(() => void load(false), 3500);
    return () => clearInterval(timer);
  }, [jobs]);

  const startImap = async (event: React.FormEvent) => {
    event.preventDefault();
    setImapBusy(true);
    try {
      const data = await apiFetch<{ import: ImportJobDTO }>("/api/v1/imports", {
        method: "POST",
        body: JSON.stringify({
          host: imap.host,
          port: Number(imap.port),
          secure: imap.secure,
          username: imap.username,
          password: imap.password,
        }),
      });
      setJobs((current) => [data.import, ...current]);
      setImap((current) => ({ ...current, password: "" }));
      toast({
        title: "IMAP import queued",
        description: "Make sure the background worker is running.",
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Could not start IMAP import",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setImapBusy(false);
    }
  };

  const uploadProtonExport = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast({ title: "Choose the ZIP file for your Proton export folder", tone: "error" });
      return;
    }
    setProtonZipBusy(true);
    try {
      const data = await apiFetch<{ import: ImportJobDTO }>("/api/v1/imports/proton-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "x-nyxmail-filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      setJobs((current) => [data.import, ...current]);
      toast({
        title: "Proton export queued",
        description: "The worker will read .eml metadata and import folders, labels, read state and stars.",
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Proton export upload failed",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setProtonZipBusy(false);
    }
  };

  const startProton = async (event: React.FormEvent) => {
    event.preventDefault();
    setProtonBusy(true);
    try {
      const data = await apiFetch<{ import: ImportJobDTO }>("/api/v1/imports/proton", {
        method: "POST",
        body: JSON.stringify({
          host: proton.host,
          port: Number(proton.port),
          username: proton.username,
          password: proton.password,
        }),
      });
      setJobs((current) => [data.import, ...current]);
      setProton((current) => ({ ...current, password: "" }));
      toast({
        title: "Proton import queued",
        description: "Folders, labels, read state and stars will be preserved by the worker.",
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Could not start Proton import",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setProtonBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".mbox") && !lower.endsWith(".mbx") && !lower.endsWith(".eml")) {
      toast({ title: "Choose an .mbox, .mbx or .eml file", tone: "error" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", lower.endsWith(".eml") ? "EML" : "MBOX");
      const data = await apiFetch<{ import: ImportJobDTO }>("/api/v1/imports/upload", {
        method: "POST",
        body: form,
      });
      setJobs((current) => [data.import, ...current]);
      toast({
        title: "File import queued",
        description: "The worker parses and encrypts each message into your mailbox.",
        tone: "success",
      });
    } catch (caught) {
      toast({
        title: "Upload failed",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setUploading(false);
    }
  };

  const act = async (job: ImportJobDTO, action: "pause" | "resume" | "cancel") => {
    setBusy(job.id);
    try {
      const data = await apiFetch<{ import: ImportJobDTO }>(`/api/v1/imports/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setJobs((current) => current.map((item) => (item.id === job.id ? data.import : item)));
    } catch (caught) {
      toast({
        title: "Import could not be updated",
        description: caught instanceof ApiClientError ? caught.message : undefined,
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/[0.08] via-surface to-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="chip border-accent/20 bg-accent/10 text-accent2">
              <Import className="h-3 w-3" /> Migration built in
            </div>
            <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">Bring your mail with you.</h2>
            <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-muted">
              Imports run as resumable background jobs. Each message is encrypted to your public key by the
              worker before it reaches PostgreSQL — the worker discards the plaintext.
            </p>
          </div>
          <span className="chip">
            <Server className="h-3 w-3" /> Worker must be online
          </span>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <a
            href="/api/v1/imports/gmail/start"
            className="group rounded-xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-soft"
          >
            <Cloud className="h-5 w-5 text-accent2" />
            <p className="mt-3 text-xs font-semibold text-ink">Connect Gmail for import</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Backfills the mailbox, then keeps checking for new Gmail messages while the worker
              is online. To send from Gmail, choose it in the composer&apos;s From menu instead — that
              does not start an import.
            </p>
            <p className="mt-3 text-[10px] font-medium text-accent2 opacity-70 group-hover:opacity-100">
              Reauthorizing an existing account will not duplicate the import →
            </p>
          </a>
          <div className="rounded-xl border border-border bg-surface p-4">
            <FileUp className="h-5 w-5 text-accent2" />
            <p className="mt-3 text-xs font-semibold text-ink">Upload mbox / EML</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Drop in an archive from Thunderbird, Apple Mail or Google Takeout. Up to 250MB per file.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".mbox,.mbx,.eml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-3"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              Choose file
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <Archive className="h-5 w-5 text-accent2" />
            <p className="mt-3 text-xs font-semibold text-ink">Export & backup</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Decrypted mbox and EML exports are available from Account settings. Nothing is exported through
              the server.
            </p>
          </div>
        </div>
        {gmailAccounts.length > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-canvas p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">
              Connected Gmail accounts
            </p>
            <div className="mt-2 space-y-1.5">
              {gmailAccounts.map((account) => (
                <div key={account.id} className="flex flex-wrap items-center gap-2 text-[10.5px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  <span className="font-medium text-ink">{account.googleEmail}</span>
                  <span className="text-faint">
                    {account.enabled
                      ? account.lastSyncAt
                        ? `synced ${new Date(account.lastSyncAt).toLocaleString()}`
                        : "waiting for first sync"
                      : "disabled"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <details className="card p-4 sm:p-5">
        <summary className="cursor-pointer text-xs font-semibold text-ink">
          Google OAuth setup for Gmail import
        </summary>
        <div className="mt-4 space-y-3 text-[10.5px] leading-relaxed text-muted">
          <p>
            This is <strong className="text-ink">read-only Gmail import</strong>, not a Google sign-in
            for the NyxMail account. The account keeps its password-derived encryption key.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Create/select a Google Cloud project and enable <strong className="text-ink">APIs &amp; Services → Library → Gmail API</strong>.</li>
            <li>Configure the OAuth consent screen; add your Google account as a test user if the app is in testing.</li>
            <li>
              Open the consent screen&apos;s <strong className="text-ink">Data Access</strong> page and add
              <code className="mx-1 font-mono text-ink">https://www.googleapis.com/auth/gmail.readonly</code>.
              Select Gmail API in the filter, or use <strong className="text-ink">Manually add scopes</strong> and paste
              the URL. <span className="text-faint">If the Gmail scope is missing from the picker, the Gmail API is not enabled in this project.</span>
            </li>
            <li>
              Do not add <code className="font-mono">openid</code> or <code className="font-mono">email</code> in the
              consent screen. They are standard OIDC scopes and do not appear there; NyxMail no longer requests them.
            </li>
            <li>Create an OAuth client of type “Web application”.</li>
            <li>
              Add this exact authorized redirect URI:
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-canvas px-2 py-1 font-mono text-[9.5px] text-ink">
                  {gmailRedirectUri}
                </code>
                <button
                  type="button"
                  className="text-[10px] font-medium text-accent2 hover:underline"
                  onClick={async () => {
                    await copyText(gmailRedirectUri);
                    toast({ title: "Redirect URI copied", tone: "success" });
                  }}
                >
                  Copy
                </button>
              </span>
            </li>
            <li>
              Put the client ID/secret in the server environment and restart web + worker:
              <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-[#07090D] p-2.5 font-mono text-[9.5px] leading-5 text-white/70">{`GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="${gmailRedirectUri}"`}</pre>
            </li>
            <li>Open Settings → Imports → Connect Gmail for import, or use the composer From menu to grant sending access.</li>
          </ol>
          <p className="text-[10px] text-faint">
            Requested scopes: <code className="font-mono">gmail.readonly</code> and
            <code className="font-mono">gmail.send</code>. The Google address is read from the
            Gmail profile API. Google never receives your NyxMail password or private key.
          </p>
        </div>
      </details>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10 text-success">
              <Archive className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Proton export folder (ZIP)</h2>
              <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-muted">
                Already exported with Proton&apos;s Export Tool? Upload the export folder as a ZIP. The
                worker reads Proton metadata and reconstructs folders, labels, stars and read state.
                No Proton Bridge needed.
              </p>
            </div>
          </div>
          <span className="chip text-[9px]">Proton Export Tool</span>
        </div>
        <div className="mt-4 grid gap-3 rounded-xl border border-border bg-canvas p-3 text-[10px] leading-relaxed text-muted sm:grid-cols-3">
          <div><span className="font-semibold text-ink">1.</span> Download your mailbox with Proton&apos;s Export Tool; it produces a <code className="font-mono text-ink">mail_*</code> folder.</div>
          <div><span className="font-semibold text-ink">2.</span> Zip that folder (keep <code className="font-mono text-ink">labels.json</code>, <code className="font-mono text-ink">.metadata.json</code> and <code className="font-mono text-ink">.eml</code> files together).</div>
          <div><span className="font-semibold text-ink">3.</span> Upload the ZIP here. Large exports can be split into multiple export folders and ZIPs.</div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <input
            ref={protonZipRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadProtonExport(file);
              event.target.value = "";
            }}
          />
          <p className="max-w-xl text-[10px] leading-relaxed text-faint">
            ZIP limit: 2GB. Labels become NyxMail labels, custom folders stay folders, messages with
            missing metadata fall back to Inbox. Messages that Proton itself could not assemble
            (no .eml file) are skipped. Imported messages are encrypted to your NyxMail public key.
          </p>
          <Button
            type="button"
            loading={protonZipBusy}
            onClick={() => protonZipRef.current?.click()}
            icon={!protonZipBusy ? <FileUp className="h-3.5 w-3.5" /> : undefined}
          >
            Upload Proton export ZIP
          </Button>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent2">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Proton Mail via Bridge</h2>
              <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-muted">
                Proton Bridge exposes your encrypted Proton mailbox over local IMAP. NyxMail imports
                Proton folders as folders, labels as labels, and preserves read/starred state.
              </p>
            </div>
          </div>
          <span className="chip text-[9px]">STARTTLS · self-signed</span>
        </div>
        <div className="mt-4 grid gap-3 rounded-xl border border-border bg-canvas p-3 text-[10px] leading-relaxed text-muted sm:grid-cols-3">
          <div><span className="font-semibold text-ink">1.</span> Install Proton Bridge on the same machine/network as the NyxMail worker and sign in.</div>
          <div><span className="font-semibold text-ink">2.</span> In Bridge, copy the IMAP username and the generated Bridge password.</div>
          <div><span className="font-semibold text-ink">3.</span> Keep Bridge private. Use loopback or a secure tunnel; never expose port 1143 publicly.</div>
        </div>
        <form onSubmit={startProton} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Input
              label="Bridge host"
              value={proton.host}
              onChange={(event) => setProton((current) => ({ ...current, host: event.target.value }))}
              placeholder="127.0.0.1"
              required
            />
          </div>
          <Input
            label="IMAP port"
            type="number"
            value={proton.port}
            onChange={(event) => setProton((current) => ({ ...current, port: event.target.value }))}
            min={1}
            max={65535}
            required
          />
          <div className="lg:col-span-2">
            <Input
              label="Proton address"
              type="email"
              value={proton.username}
              onChange={(event) => setProton((current) => ({ ...current, username: event.target.value }))}
              placeholder="you@proton.me"
              autoComplete="username"
              required
            />
          </div>
          <Input
            label="Bridge password"
            type="password"
            value={proton.password}
            onChange={(event) => setProton((current) => ({ ...current, password: event.target.value }))}
            autoComplete="current-password"
            required
          />
          <div className="sm:col-span-2 lg:col-span-6 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xl text-[10px] leading-relaxed text-faint">
              Bridge uses a self-signed certificate; the importer accepts it only for this dedicated
              connection. All Mail and Starred are skipped to avoid duplicate messages — labels,
              folders, flags and stars are merged into the existing copies.
            </p>
            <Button type="submit" loading={protonBusy} icon={!protonBusy ? <Import className="h-3.5 w-3.5" /> : undefined}>
              Import Proton mailbox
            </Button>
          </div>
        </form>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Server className="h-4 w-4 text-accent2" />
          <div>
            <h2 className="text-sm font-semibold text-ink">Generic IMAP</h2>
            <p className="mt-0.5 text-[11px] text-muted">Credentials are encrypted with AES-256-GCM at rest.</p>
          </div>
        </div>
        <form onSubmit={startImap} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Input
              label="IMAP host"
              value={imap.host}
              onChange={(event) => setImap((current) => ({ ...current, host: event.target.value }))}
              placeholder="imap.example.com"
              required
            />
          </div>
          <Input
            label="Port"
            type="number"
            value={imap.port}
            onChange={(event) => setImap((current) => ({ ...current, port: event.target.value }))}
            min={1}
            max={65535}
            required
          />
          <div>
            <Select
              label="TLS"
              ariaLabel="Use TLS"
              value={imap.secure ? "yes" : "no"}
              onChange={(value) =>
                setImap((current) => ({ ...current, secure: value === "yes" }))
              }
              options={[
                { value: "yes", label: "Implicit TLS", hint: "Recommended · port 993" },
                { value: "no", label: "STARTTLS / plain", hint: "Upgrades on port 143" },
              ]}
            />
          </div>
          <Input
            label="Username"
            value={imap.username}
            onChange={(event) => setImap((current) => ({ ...current, username: event.target.value }))}
            autoComplete="username"
            required
          />
          <Input
            label="Password / app password"
            type="password"
            value={imap.password}
            onChange={(event) => setImap((current) => ({ ...current, password: event.target.value }))}
            autoComplete="current-password"
            required
          />
          <div className="sm:col-span-2 lg:col-span-6 flex justify-end">
            <Button type="submit" loading={imapBusy} icon={!imapBusy ? <Import className="h-3.5 w-3.5" /> : undefined}>
              Start IMAP import
            </Button>
          </div>
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Import jobs</h2>
            <p className="mt-0.5 text-[11px] text-muted">Progress is written by the background worker.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load(true)} loading={loading}>
            Refresh
          </Button>
        </div>
        <div className="divide-y divide-border">
          {jobs.length === 0 && !loading && (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Clock3 className="h-5 w-5 text-faint" />
              <p className="text-xs font-medium text-ink">No imports yet</p>
              <p className="text-[11px] text-muted">Connect Google, enter IMAP details or upload an archive above.</p>
            </div>
          )}
          {loading && jobs.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-faint" />
            </div>
          )}
          {jobs.map((job) => {
            const percent =
              job.totalMessages > 0
                ? Math.min(100, (job.progressMessages / job.totalMessages) * 100)
                : job.status === "COMPLETED"
                  ? 100
                  : 3;
            return (
              <div key={job.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-ink">{importSource(job)}</p>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide", STATUS_STYLE[job.status])}>
                    {job.status.toLowerCase()}
                  </span>
                  <span className="ml-auto text-[10px] text-faint">
                    {job.progressMessages.toLocaleString()} / {job.totalMessages ? job.totalMessages.toLocaleString() : "—"}
                    {job.status === "RUNNING" && ` · ${eta(job)}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      job.status === "FAILED"
                        ? "bg-danger"
                        : job.status === "PAUSED"
                          ? "bg-warning"
                          : job.status === "COMPLETED"
                            ? "bg-success"
                            : "bg-gradient-to-r from-accent to-accent2",
                    )}
                    style={{ width: `${Math.max(2, percent)}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-faint">
                    {job.status === "COMPLETED" && job.completedAt
                      ? `Completed ${new Date(job.completedAt).toLocaleString()}`
                      : `Started ${new Date(job.startedAt || job.createdAt).toLocaleString()}`}
                    {Object.keys(job.folderMapping).length > 0 && ` · ${Object.keys(job.folderMapping).length} folders mapped`}
                  </span>
                  <div className="ml-auto flex gap-1">
                    {["PENDING", "RUNNING"].includes(job.status) && (
                      <Button size="sm" variant="ghost" onClick={() => void act(job, "pause")} disabled={busy === job.id}>
                        <Pause className="h-3 w-3" /> Pause
                      </Button>
                    )}
                    {job.status === "PAUSED" && (
                      <Button size="sm" variant="ghost" onClick={() => void act(job, "resume")} disabled={busy === job.id}>
                        <Play className="h-3 w-3" /> Resume
                      </Button>
                    )}
                    {["PENDING", "RUNNING", "PAUSED"].includes(job.status) && (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => void act(job, "cancel")} disabled={busy === job.id}>
                        <XCircle className="h-3 w-3" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {job.errors.length > 0 && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-danger/15 bg-danger/[0.04] px-2.5 py-2 text-[10px] text-danger">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <div>
                      {job.errors.slice(-2).map((error, index) => (
                        <p key={index} className="truncate">{error}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
