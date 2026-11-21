"use client";

import { useState } from "react";
import { KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/lib/client/auth";
import { useCrypto } from "@/lib/client/crypto";
import { useToast } from "@/lib/client/toast";

export function UnlockGate() {
  const { user, logout } = useAuth();
  const { unlockWithPassword } = useCrypto();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlockWithPassword(password);
      setPassword("");
      toast({
        title: "Mailbox unlocked",
        description: "Your private key stays available in this tab until you sign out or close it.",
        tone: "success",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock the mailbox.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-5">
            <div className="absolute -inset-4 rounded-full bg-accent/15 blur-2xl" aria-hidden="true" />
            <LogoMark className="relative h-14 w-14 rounded-2xl" />
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface">
              <LockKeyhole className="h-3 w-3 text-accent2" />
            </span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Unlock {user?.displayName || "your mailbox"}</h1>
          <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-muted">
            Your private key is encrypted at rest. Enter your password to decrypt it in this tab. It is never
            sent to the server.
          </p>
        </div>
        <form onSubmit={unlock} className="card space-y-4 p-5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-canvas px-3 py-2 text-[11px]">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            <span className="truncate text-muted">{user?.email}</span>
          </div>
          <Input
            label="Password"
            name="unlock-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            leading={<KeyRound className="h-4 w-4" />}
            error={error || undefined}
            required
          />
          <Button type="submit" fullWidth loading={busy} icon={!busy ? <LockKeyhole className="h-4 w-4" /> : undefined}>
            Unlock mailbox
          </Button>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 text-[10px] text-faint hover:text-muted"
            onClick={() => void logout()}
          >
            <LogOut className="h-3 w-3" /> Sign out instead
          </button>
        </form>
      </div>
    </main>
  );
}
