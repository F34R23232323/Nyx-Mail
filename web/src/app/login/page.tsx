"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import type { UserDTO } from "@nyxmail/shared";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { useToast } from "@/lib/client/toast";
import { safeRedirectPath } from "@nyxmail/shared";

type Phase = "credentials" | "mfa" | "setup";

interface LoginResponse {
  mfaRequired?: boolean;
  requiresSetup?: boolean;
  mfaToken?: string;
  methods?: string[];
  hasPasskeys?: boolean;
  setupToken?: string;
  totpSecret?: string;
  otpauthUri?: string;
  qrDataUrl?: string;
  email: string;
  displayName?: string;
}

interface SessionResponse {
  user: UserDTO;
}

function LoginPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { setUser } = useAuth();
  const { unlockWithPassword } = useCrypto();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginData, setLoginData] = useState<LoginResponse | null>(null);
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef(password);
  passwordRef.current = password;

  const nextPath = safeRedirectPath(params.get("next"));

  useEffect(() => {
    const notice = params.get("recovered");
    if (notice) toast({ title: "Password reset", description: "Sign in with your new password.", tone: "success" });
  }, [params, toast]);

  const finish = async (user: UserDTO) => {
    setUser(user);
    try {
      await unlockWithPassword(passwordRef.current);
    } catch {
      // Session is valid; the inbox will prompt to unlock the private key.
    }
    router.replace(nextPath);
  };

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch<LoginResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setLoginData(data);
      setEmail(data.email);
      if (data.requiresSetup && data.setupToken) {
        setTotpSecret(data.totpSecret || "");
        setQrDataUrl(data.qrDataUrl || "");
        setPhase("setup");
      } else {
        setPhase("mfa");
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginData?.mfaToken) return;
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch<SessionResponse>("/api/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          mfaToken: loginData.mfaToken,
          method,
          code: code.replace(/\s/g, ""),
        }),
      });
      await finish(data.user);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const usePasskey = async () => {
    if (!loginData?.mfaToken) return;
    setError(null);
    setPasskeyBusy(true);
    try {
      const options = await apiFetch<{ options: Record<string, unknown>; flowToken: string }>(
        "/api/v1/auth/webauthn/options",
        { method: "POST", body: JSON.stringify({ mfaToken: loginData.mfaToken }) },
      );
      const credential = await startAuthentication(
        options.options as unknown as Parameters<typeof startAuthentication>[0],
      );
      const data = await apiFetch<SessionResponse>("/api/v1/auth/webauthn/verify", {
        method: "POST",
        body: JSON.stringify({
          mfaToken: loginData.mfaToken,
          flowToken: options.flowToken,
          response: credential,
        }),
      });
      await finish(data.user);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : caught instanceof Error && caught.name === "NotAllowedError"
            ? "Passkey prompt was cancelled."
            : "Passkey sign-in failed.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  const finishSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginData?.setupToken) return;
    setError(null);
    setBusy(true);
    try {
      const enabled = await apiFetch<SessionResponse & { backupCodes: string[] }>(
        "/api/v1/auth/two-factor/enable",
        {
          method: "POST",
          body: JSON.stringify({
            setupToken: loginData.setupToken,
            code: code.replace(/\s/g, ""),
          }),
        },
      );
      await finish(enabled.user);
      toast({
        title: "Two-factor setup complete",
        description: `${enabled.backupCodes.length} backup codes were generated. Review them in Settings → Security.`,
        tone: "success",
      });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Could not complete 2FA setup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={
        phase === "credentials"
          ? "Welcome back"
          : phase === "mfa"
            ? "One more step"
            : "Finish securing your account"
      }
      subtitle={
        phase === "credentials"
          ? "Sign in to your encrypted inbox. Your password unlocks your private key locally."
          : phase === "mfa"
            ? "Enter the code from your authenticator app, a backup code, or use a passkey."
            : "Your account was created but 2FA was not completed. Scan this code and confirm to continue."
      }
      footer={
        phase === "credentials" ? (
          <div className="flex flex-col gap-2">
            <span>
              New to NyxMail?{" "}
              <Link href="/signup" className="font-medium text-accent2 hover:underline">
                Create an account
              </Link>
            </span>
            <Link href="/recover" className="text-[11px] text-faint hover:text-muted">
              Lost your password? Use a recovery kit
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setPhase("credentials");
              setError(null);
              setCode("");
            }}
            className="inline-flex items-center gap-1 text-muted hover:text-ink"
          >
            <ArrowLeft className="h-3 w-3" /> Use a different account
          </button>
        )
      }
    >
      {error && (
        <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] p-3 text-xs leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {phase === "credentials" && (
        <form onSubmit={submitCredentials} className="space-y-4">
          <Input
            label="Email address"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder="you@your-domain.tld"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
          <Input
            label="Password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Your password"
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
          <Button fullWidth type="submit" loading={busy} icon={!busy ? <ArrowRight className="h-4 w-4" /> : undefined}>
            Continue
          </Button>
          <div className="rounded-xl border border-border bg-surface/70 p-3 text-[11px] leading-relaxed text-muted">
            <span className="font-medium text-ink">Private by construction.</span> Your password is used to
            derive a local encryption key. NyxMail never receives that derived key.
          </div>
        </form>
      )}

      {phase === "mfa" && loginData && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted">
            <ShieldCheck className="h-4 w-4 text-success" />
            Signing in as <span className="font-medium text-ink">{loginData.email}</span>
          </div>
          {loginData.methods?.includes("webauthn") && (
            <Button
              fullWidth
              variant="secondary"
              loading={passkeyBusy}
              onClick={usePasskey}
              icon={<Fingerprint className="h-4 w-4" />}
            >
              Use a passkey
            </Button>
          )}
          {loginData.methods?.includes("webauthn") && (
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-faint">
              <span className="h-px flex-1 bg-border" /> or use a code <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <form onSubmit={verifyCode} className="space-y-4">
            <Input
              label={method === "totp" ? "Authenticator code" : "Backup code"}
              name="code"
              inputMode={method === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              autoFocus
              placeholder={method === "totp" ? "000000" : "XXXX-XXXX"}
              value={code}
              onChange={(event) =>
                setCode(
                  method === "totp"
                    ? event.target.value.replace(/\D/g, "").slice(0, 6)
                    : event.target.value.toUpperCase().slice(0, 12),
                )
              }
              leading={method === "totp" ? <Smartphone className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              required
            />
            <Button
              fullWidth
              type="submit"
              loading={busy}
              disabled={method === "totp" ? code.length !== 6 : code.length < 8}
            >
              Verify and open inbox
            </Button>
          </form>
          <button
            type="button"
            className="w-full text-center text-[11px] text-faint hover:text-muted"
            onClick={() => {
              setMethod(method === "totp" ? "backup" : "totp");
              setCode("");
              setError(null);
            }}
          >
            {method === "totp" ? "Use a one-time backup code" : "Use my authenticator app instead"}
          </button>
          <p className="text-center text-[10px] text-faint">
            Sessions are protected by rotating refresh tokens. You can revoke devices in Settings → Security.
          </p>
        </div>
      )}

      {phase === "setup" && (
        <form onSubmit={finishSetup} className="space-y-4">
          {qrDataUrl ? (
            <div className="flex justify-center rounded-xl border border-border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Two-factor setup QR code" className="h-44 w-44" />
            </div>
          ) : null}
          {totpSecret && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-[10px] uppercase tracking-wider text-faint">Manual setup key</p>
              <code className="mt-1 block break-all font-mono text-[11px] text-ink">{totpSecret}</code>
            </div>
          )}
          <Input
            label="6-digit code"
            name="setupCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <Button fullWidth type="submit" loading={busy} disabled={code.length !== 6}>
            Finish setup
          </Button>
        </form>
      )}
    </AuthShell>
  );
}


export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas text-xs text-faint">
          Loading secure sign-in…
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
