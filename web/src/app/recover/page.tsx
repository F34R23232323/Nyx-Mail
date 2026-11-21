"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileKey2,
  KeyRound,
  LockKeyhole,
} from "lucide-react";
import { createKeyEnvelope, isValidRecoveryPhrase, sha256Hex, unlockKeyBundleWithPhrase } from "@nyxmail/crypto";
import { normalizeEmail } from "@nyxmail/shared";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { apiFetch, ApiClientError } from "@/lib/client/api";

interface RecoveryStart {
  email: string;
  recoverySalt: string;
  recoveryEncryptedPrivateKey: string;
}

type Phase = "phrase" | "password" | "done";

export default function RecoverPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("phrase");
  const [email, setEmail] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [starter, setStarter] = useState<RecoveryStart | null>(null);
  const [bundleJson, setBundleJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validatePhrase = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isValidRecoveryPhrase(normalized)) {
      setError("That is not a valid 24-word recovery phrase.");
      return;
    }
    setBusy(true);
    try {
      const phraseHash = await sha256Hex(normalized);
      const data = await apiFetch<RecoveryStart>("/api/v1/auth/recovery/start", {
        method: "POST",
        body: JSON.stringify({ email: normalizeEmail(email), phraseHash }),
      });
      const bundle = await unlockKeyBundleWithPhrase(
        data.recoveryEncryptedPrivateKey,
        data.recoverySalt,
        normalized,
      );
      setStarter(data);
      setBundleJson(JSON.stringify(bundle));
      setPhase("password");
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "That phrase could not decrypt the account. Check every word.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 10) return setError("Use at least 10 characters.");
    if (newPassword !== confirm) return setError("Passwords do not match.");
    if (!starter) return;
    setBusy(true);
    try {
      const bundle = JSON.parse(bundleJson) as Awaited<ReturnType<typeof unlockKeyBundleWithPhrase>>;
      const envelope = await createKeyEnvelope(bundle, newPassword);
      const phraseHash = await sha256Hex(phrase.trim().toLowerCase().replace(/\s+/g, " "));
      await apiFetch("/api/v1/auth/recovery/complete", {
        method: "POST",
        body: JSON.stringify({
          email: starter.email,
          phraseHash,
          newPassword,
          encryptedPrivateKey: envelope.encryptedPrivateKey,
          argonSalt: envelope.argonSalt,
        }),
      });
      setPhase("done");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={phase === "done" ? "Password reset" : "Recover your mailbox"}
      subtitle={
        phase === "phrase"
          ? "Enter your account email and the 24-word recovery phrase you saved at signup."
          : phase === "password"
            ? "Your private key is unlocked locally. Choose a new password to re-encrypt it."
            : "Your encrypted key has been re-wrapped. Sign in with your new password and authenticator."
      }
      footer={
        <Link href="/login" className="inline-flex items-center gap-1 text-muted hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to sign in
        </Link>
      }
    >
      {error && (
        <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] p-3 text-xs leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {phase === "phrase" && (
        <form onSubmit={validatePhrase} className="space-y-4">
          <div className="flex gap-2 rounded-xl border border-warning/20 bg-warning/[0.06] p-3 text-[11px] leading-relaxed text-muted">
            <FileKey2 className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            The recovery phrase is sent to the server only as a salted hash. Decryption happens in this
            browser. Your authenticator is still required to sign in.
          </div>
          <Input
            label="Account email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@your-domain.tld"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Textarea
            label="24-word recovery phrase"
            name="phrase"
            placeholder="word one two three …"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="min-h-[120px] font-mono text-[12px] leading-relaxed"
            autoComplete="off"
            spellCheck={false}
            required
          />
          <Button fullWidth type="submit" loading={busy} icon={!busy ? <KeyRound className="h-4 w-4" /> : undefined}>
            Unlock with recovery phrase
          </Button>
        </form>
      )}

      {phase === "password" && (
        <form onSubmit={resetPassword} className="space-y-4">
          <div className="flex gap-2 rounded-xl border border-success/20 bg-success/[0.06] p-3 text-[11px] leading-relaxed text-muted">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            Phrase verified and private key decrypted locally. Choose a new password — it will replace the
            old encrypted key on the server.
          </div>
          <Input
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            leading={<LockKeyhole className="h-4 w-4" />}
            required
          />
          <Input
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
          <Button fullWidth type="submit" loading={busy} icon={!busy ? <ArrowRight className="h-4 w-4" /> : undefined}>
            Reset password
          </Button>
        </form>
      )}

      {phase === "done" && (
        <div className="space-y-5 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            Your password has been updated and all previous sessions were revoked. Sign in with your new
            password, then confirm your authenticator code.
          </p>
          <Button fullWidth onClick={() => router.replace("/login?recovered=1")}>
            Continue to sign in
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
