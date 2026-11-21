"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import zxcvbn from "zxcvbn";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import {
  createKeyEnvelope,
  createRecoveryKit,
  generateKeyBundle,
  type KeyBundle,
} from "@nyxmail/crypto";
import type { UserDTO } from "@nyxmail/shared";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { useToast } from "@/lib/client/toast";
import { cn, copyText, downloadText } from "@/lib/client/utils";

type Step = "form" | "recovery" | "totp" | "backup";

interface SignupResponse {
  setupToken: string;
  totpSecret: string;
  otpauthUri: string;
  qrDataUrl: string;
  email: string;
  displayName: string;
}

interface EnableResponse {
  user: UserDTO;
  backupCodes: string[];
}

const SCORE_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];
const SCORE_COLORS = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

export default function SignupPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const { setBundle } = useCrypto();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("form");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [bundle, setLocalBundle] = useState<KeyBundle | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [savedRecovery, setSavedRecovery] = useState(false);
  const [setup, setSetup] = useState<SignupResponse | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [signupDomains, setSignupDomains] = useState<string[]>([]);

  useEffect(() => {
    void fetch("/api/v1/config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signupDomains?: string[] } | null) => {
        if (data?.signupDomains?.length) setSignupDomains(data.signupDomains);
      })
      .catch(() => undefined);
  }, []);

  const strength = useMemo(() => (password ? zxcvbn(password) : null), [password]);

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!displayName.trim()) return setError("Add a display name.");
    if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (strength && strength.score < 2) return setError("Choose a stronger password (at least 'Fair').");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setBusyLabel("Generating your keys…");
    try {
      const keyBundle = await generateKeyBundle();
      setBusyLabel("Deriving your key with Argon2id…");
      const envelope = await createKeyEnvelope(keyBundle, password);
      setBusyLabel("Creating your recovery kit…");
      const recovery = await createRecoveryKit(keyBundle);
      setBusyLabel("Registering your encrypted account…");
      const data = await apiFetch<SignupResponse>("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          displayName: displayName.trim(),
          password,
          publicKey: keyBundle.publicKey,
          signingPublicKey: keyBundle.signingPublicKey,
          encryptedPrivateKey: envelope.encryptedPrivateKey,
          argonSalt: envelope.argonSalt,
          recoveryEncryptedPrivateKey: recovery.encryptedPrivateKey,
          recoverySalt: recovery.argonSalt,
          recoveryKeyHash: recovery.recoveryKeyHash,
          recoveryEmail: recoveryEmail.trim() || undefined,
        }),
      });
      setLocalBundle(keyBundle);
      setRecoveryPhrase(recovery.phrase);
      setSetup(data);
      setEmail(data.email);
      setStep("recovery");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not create your account.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const enableTotp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setup) return;
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch<EnableResponse>("/api/v1/auth/two-factor/enable", {
        method: "POST",
        body: JSON.stringify({ setupToken: setup.setupToken, code: code.replace(/\s/g, "") }),
      });
      if (bundle) setBundle(bundle);
      setUser(data.user);
      setBackupCodes(data.backupCodes);
      setStep("backup");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not verify that code.");
    } finally {
      setBusy(false);
    }
  };

  const downloadRecovery = () => {
    downloadText(
      [
        "NYXMAIL RECOVERY KIT",
        "====================",
        "",
        `Account: ${email}`,
        `Created: ${new Date().toISOString()}`,
        "",
        "RECOVERY PHRASE (24 words)",
        recoveryPhrase,
        "",
        "Keep this offline. Anyone with this phrase and access to your account email,",
        "server recovery flow and 2FA device could unlock your mailbox. NyxMail cannot",
        "regenerate this phrase. Store it somewhere safe.",
        "",
        "Your password is never stored in this file.",
      ].join("\n"),
      "nyxmail-recovery-kit.txt",
    );
  };

  const downloadBackupCodes = () => {
    downloadText(
      [
        "NYXMAIL ONE-TIME BACKUP CODES",
        "=============================",
        `Account: ${email}`,
        `Generated: ${new Date().toISOString()}`,
        "",
        ...backupCodes,
        "",
        "Each code works once. Regenerate them from Settings → Security.",
      ].join("\n"),
      "nyxmail-backup-codes.txt",
    );
  };

  return (
    <AuthShell
      title={
        step === "form"
          ? "Create your private inbox"
          : step === "recovery"
            ? "Save your recovery kit"
            : step === "totp"
              ? "Protect your keys"
              : "Your backup codes"
      }
      subtitle={
        step === "form"
          ? "Your encryption keys are generated in this browser. The server never sees your private key."
          : step === "recovery"
            ? "This 24-word phrase is the only alternative way to decrypt your mailbox. It will not be shown again."
            : step === "totp"
              ? "Two-factor authentication is mandatory. Scan the code with any TOTP app."
              : "Store these somewhere offline. Each code can be used once if you lose your authenticator."
      }
      footer={
        step === "form" ? (
          <>
            Already have an inbox?{" "}
            <Link href="/login" className="font-medium text-accent2 hover:underline">
              Sign in
            </Link>
          </>
        ) : step === "backup" ? null : (
          <button type="button" onClick={() => setStep("form")} className="inline-flex items-center gap-1 text-muted hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Back to details
          </button>
        )
      }
    >
      {step === "form" && (
        <form onSubmit={submitForm} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="flex gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] p-3 text-xs leading-relaxed text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <Input
            label="Display name"
            name="displayName"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            required
          />
          <Input
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder={signupDomains[0] ? `you@${signupDomains[0]}` : "you@your-domain.tld"}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            hint={
              signupDomains.length > 1
                ? `Allowed domains: ${signupDomains.map((domain) => `@${domain}`).join(", ")}`
                : "Must be on the domain configured by your server administrator."
            }
            required
          />
          <div>
            <Input
              label="Password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="A long, unique passphrase"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              leading={<LockKeyhole className="h-4 w-4" />}
              trailing={
                <button
                  type="button"
                  className="icon-btn h-7 w-7"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              }
              required
            />
            {password && strength && (
              <div className="mt-2">
                <div className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className={cn(
                        "h-1 flex-1 rounded-full",
                        index < strength.score ? SCORE_COLORS[strength.score] : "bg-raised",
                      )}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className={strength.score >= 3 ? "text-success" : strength.score >= 2 ? "text-warning" : "text-danger"}>
                    {SCORE_LABELS[strength.score]}
                  </span>
                  <span className="text-faint">
                    {strength.feedback.warning || strength.feedback.suggestions[0] || "Use 4+ unrelated words"}
                  </span>
                </div>
              </div>
            )}
          </div>
          <Input
            label="Confirm password"
            name="confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
          <Input
            label="Recovery email (optional)"
            name="recoveryEmail"
            type="email"
            autoComplete="email"
            placeholder="backup@example.com"
            value={recoveryEmail}
            onChange={(event) => setRecoveryEmail(event.target.value)}
            hint="Only used for account notices. It cannot decrypt your mailbox."
          />
          <div className="rounded-xl border border-warning/20 bg-warning/[0.05] p-3 text-[11px] leading-relaxed text-muted">
            <span className="font-semibold text-warning">Password loss is permanent.</span> Your private key is
            encrypted with your password. NyxMail cannot reset or read it.
          </div>
          <Button type="submit" fullWidth loading={busy} icon={!busy ? <ArrowRight className="h-4 w-4" /> : undefined}>
            {busy ? busyLabel : "Create encrypted account"}
          </Button>
        </form>
      )}

      {step === "recovery" && (
        <div className="space-y-5">
          <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-[11px] leading-relaxed text-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Write these words down or save the file offline. The phrase is not stored on the server in
              readable form and cannot be recovered.
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3">
            {recoveryPhrase.split(" ").map((word, index) => (
              <div key={`${word}-${index}`} className="flex items-center gap-2 rounded-lg bg-canvas px-2 py-1.5">
                <span className="w-4 text-right text-[9px] tabular-nums text-faint">{index + 1}</span>
                <span className="font-mono text-[11px] text-ink">{word}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={async () => {
                await copyText(recoveryPhrase);
                toast({ title: "Recovery phrase copied", tone: "success" });
              }}
              icon={<Copy className="h-4 w-4" />}
              className="flex-1"
            >
              Copy phrase
            </Button>
            <Button
              variant="secondary"
              onClick={downloadRecovery}
              icon={<Download className="h-4 w-4" />}
              className="flex-1"
            >
              Download kit
            </Button>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3.5">
            <input
              type="checkbox"
              checked={savedRecovery}
              onChange={(event) => setSavedRecovery(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#6D4AFF]"
            />
            <span className="text-xs leading-relaxed text-muted">
              I have saved my recovery phrase somewhere safe and understand it cannot be recovered.
            </span>
          </label>
          <Button
            fullWidth
            disabled={!savedRecovery}
            onClick={() => setStep("totp")}
            icon={<ArrowRight className="h-4 w-4" />}
          >
            Continue to two-factor setup
          </Button>
        </div>
      )}

      {step === "totp" && setup && (
        <form onSubmit={enableTotp} className="space-y-5">
          {error && (
            <div role="alert" className="rounded-xl border border-danger/25 bg-danger/[0.07] p-3 text-xs text-danger">
              {error}
            </div>
          )}
          <div className="flex justify-center rounded-2xl border border-border bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="QR code for NyxMail two-factor setup" className="h-48 w-48" />
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-faint">Can&apos;t scan?</p>
            <p className="mt-1 flex items-center justify-between gap-2">
              <code className="select-all break-all font-mono text-[11px] text-ink">{setup.totpSecret}</code>
              <button
                type="button"
                className="icon-btn h-7 w-7 shrink-0"
                aria-label="Copy TOTP secret"
                onClick={async () => {
                  await copyText(setup.totpSecret);
                  toast({ title: "Secret copied", tone: "success" });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </p>
          </div>
          <Input
            label="6-digit code"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            leading={<Smartphone className="h-4 w-4" />}
            autoFocus
            required
          />
          <Button
            fullWidth
            type="submit"
            loading={busy}
            disabled={code.length !== 6}
            icon={!busy ? <ShieldCheck className="h-4 w-4" /> : undefined}
          >
            Enable two-factor authentication
          </Button>
          <p className="text-center text-[11px] text-faint">
            You&apos;ll receive 10 one-time backup codes on the next screen.
          </p>
        </form>
      )}

      {step === "backup" && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/[0.06] p-3.5">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <div>
              <p className="text-xs font-semibold text-ink">Two-factor authentication enabled</p>
              <p className="text-[11px] text-muted">Your account and keys are now protected.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-surface p-3">
            {backupCodes.map((backupCode) => (
              <code key={backupCode} className="rounded-lg bg-canvas px-2.5 py-2 text-center font-mono text-[12px] text-ink">
                {backupCode}
              </code>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              onClick={async () => {
                await copyText(backupCodes.join("\n"));
                toast({ title: "Backup codes copied", tone: "success" });
              }}
              icon={<Copy className="h-4 w-4" />}
              className="flex-1"
            >
              Copy codes
            </Button>
            <Button
              variant="secondary"
              onClick={downloadBackupCodes}
              icon={<Download className="h-4 w-4" />}
              className="flex-1"
            >
              Download
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent2" />
            These codes are shown once. You can regenerate them later from Settings → Security.
          </div>
          <Button fullWidth onClick={() => router.replace("/mail")} icon={<ArrowRight className="h-4 w-4" />}>
            Open my inbox
          </Button>
        </div>
      )}

      {step === "form" && (
        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-faint">
          <Loader2 className={cn("h-3 w-3", busy ? "animate-spin" : "hidden")} />
          <LockKeyhole className="h-3 w-3" />
          <span>Keys generated locally · Argon2id · X25519</span>
        </div>
      )}
    </AuthShell>
  );
}
