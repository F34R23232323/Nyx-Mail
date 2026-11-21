import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo, LogoMark } from "@/components/ui/Logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="aurora pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" aria-label="NyxMail home">
            <Logo />
          </Link>
          <span className="chip border-white/10 bg-white/5 text-white/60">
            <LockKeyhole className="h-3 w-3" /> Zero access
          </span>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-white/10 bg-[#232128]/70 p-5 shadow-soft backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <LogoMark className="h-7 w-7" />
                <div>
                  <p className="text-xs font-semibold text-white">NyxMail</p>
                  <p className="text-[10px] text-white/40">Private inbox</p>
                </div>
              </div>
              <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                Encrypted
              </span>
            </div>
            <div className="space-y-2.5">
              {[
                { from: "Ada Lovelace", subject: "The analytical engine", color: "#6D4AFF" },
                { from: "Grace Hopper", subject: "Notes on the compiler", color: "#14B8A6" },
              ].map((item) => (
                <div key={item.from} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: item.color }}
                  >
                    {item.from.split(" ").map((p) => p[0]).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <p className="truncate text-[11px] font-semibold text-white/85">{item.from}</p>
                      <span className="text-[9px] text-white/25">now</span>
                    </div>
                    <p className="truncate text-[10px] text-white/40">{item.subject}</p>
                  </div>
                  <LockKeyhole className="h-3 w-3 text-accent2/70" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/[0.08] px-3 py-2 text-[10px] text-white/50">
              <ShieldCheck className="h-3.5 w-3.5 text-accent2" />
              Only your browser holds the key to this mailbox.
            </div>
          </div>

          <div className="mt-8 space-y-3">
            {[
              "Keys generated in your browser, never transmitted",
              "Argon2id password hardening",
              "TOTP, passkeys and one-time backup codes",
            ].map((line) => (
              <div key={line} className="flex items-center gap-2.5 text-[13px] text-white/60">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/10">
                  <Check className="h-3 w-3 text-success" />
                </span>
                {line}
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 max-w-sm text-[11px] leading-relaxed text-white/30">
          Open source. Self-hosted. Your domain, your database, your keys. No analytics, no ad tech,
          no content scanning.
        </p>
      </aside>

      <main id="main" className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px] animate-in">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link href="/" aria-label="NyxMail home">
              <Logo />
            </Link>
            <Link href="/" className="icon-btn" aria-label="Back to home">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </div>
          <div className="mb-7">
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">{title}</h1>
            {subtitle && <p className="mt-2 text-[13px] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="mt-7 text-center text-xs text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
