"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  Fingerprint,
  Github,
  Import,
  KeyRound,
  LockKeyhole,
  Mail,
  MousePointerClick,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  Users,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/ui/Logo";

const repositoryUrl = process.env.NEXT_PUBLIC_REPOSITORY_URL?.trim();

const features = [
  {
    icon: <LockKeyhole className="h-5 w-5" />,
    title: "Zero-access encryption",
    body: "Subjects, bodies and attachments are sealed in your browser. PostgreSQL only ever sees ciphertext.",
  },
  {
    icon: <KeyRound className="h-5 w-5" />,
    title: "Keys you own",
    body: "X25519 + Ed25519 keypairs are generated locally and protected with an Argon2id-derived key.",
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Hardened sign-in",
    body: "Mandatory TOTP, single-use backup codes, optional passkeys and revocable device sessions.",
  },
  {
    icon: <Import className="h-5 w-5" />,
    title: "Bring your archive",
    body: "Gmail OAuth, generic IMAP, mbox and EML imports run as resumable background jobs.",
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: "Real mail features",
    body: "Threads, labels, contacts, aliases, snooze, scheduled send and a decrypted local search index.",
  },
  {
    icon: <Server className="h-5 w-5" />,
    title: "Self-hosted by design",
    body: "One Postgres database, one Next.js service and a worker. Plug in Haraka or Postfix when you go live.",
  },
];

const flow = [
  {
    step: "01",
    icon: <MousePointerClick className="h-4 w-4" />,
    title: "You type your password",
    body: "Argon2id derives a 256-bit key inside the browser. The password itself is only used for server-side hashing over TLS.",
  },
  {
    step: "02",
    icon: <Fingerprint className="h-4 w-4" />,
    title: "Your private key unlocks",
    body: "The encrypted private key comes down over an authenticated session and is decrypted in memory only. Reloads ask you to unlock again.",
  },
  {
    step: "03",
    icon: <Database className="h-4 w-4" />,
    title: "The server stores secrets it can't open",
    body: "A random message key seals each message. Only per-recipient X25519 sealed copies of that key are stored.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/70 bg-canvas/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6" aria-label="Main">
          <Link href="/" aria-label="NyxMail home">
            <Logo />
          </Link>
          <div className="hidden items-center gap-7 text-[13px] font-medium text-muted md:flex">
            <a href="#features" className="transition-colors hover:text-ink">Features</a>
            <a href="#security" className="transition-colors hover:text-ink">Security</a>
            <a href="#self-host" className="transition-colors hover:text-ink">Self-host</a>
            <a href="#migrate" className="transition-colors hover:text-ink">Migration</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary btn-sm">
              Create account <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </nav>
      </header>

      <main id="main">
        <section className="aurora relative overflow-hidden pb-20 pt-32 sm:pt-40">
          <div className="grid-lines pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="chip mb-6 border-accent/20 bg-accent/[0.06] text-accent2">
                <LockKeyhole className="h-3 w-3" />
                Zero-access encrypted webmail
              </div>
              <h1 className="max-w-xl text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.045em] text-ink sm:text-5xl lg:text-[58px]">
                Your inbox.
                <br />
                <span className="bg-gradient-to-r from-accent2 via-[#A78BFA] to-[#22C55E] bg-clip-text text-transparent">
                  Your keys. Nothing else.
                </span>
              </h1>
              <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted">
                NyxMail is a privacy-first mail server and web client you can run yourself. Messages are
                encrypted before upload, so the database can&apos;t read them — even if someone asks it to.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className="btn btn-primary px-5 py-3">
                  Create your private inbox <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#security" className="btn btn-secondary px-5 py-3">
                  See how it works
                </a>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-faint">
                {["Self-hosted", "Open source", "No tracking", "Import from Gmail"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-success" /> {item}
                  </span>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.12, ease: "easeOut" }}
              className="relative"
            >
              <div className="absolute -inset-6 rounded-[2rem] bg-accent/10 blur-3xl" aria-hidden="true" />
              <div className="relative overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-soft backdrop-blur">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <LogoMark className="h-6 w-6" />
                    <span className="text-xs font-semibold text-ink">Inbox</span>
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent2">
                      3
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[9px] font-medium text-success">
                    <ShieldCheck className="h-2.5 w-2.5" /> End-to-end
                  </span>
                </div>
                <div className="grid grid-cols-[110px_1fr]">
                  <div className="border-r border-border p-3">
                    <div className="mb-4 flex items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[10px] font-semibold text-white">
                      <Mail className="h-3 w-3" /> Compose
                    </div>
                    {[
                      ["Inbox", "3"],
                      ["Starred", ""],
                      ["Sent", ""],
                      ["Archive", ""],
                      ["Spam", ""],
                      ["Trash", ""],
                    ].map(([label, count], index) => (
                      <div
                        key={label}
                        className={`mb-0.5 flex items-center justify-between rounded-md px-2 py-1.5 text-[10px] ${
                          index === 0 ? "bg-accent/10 text-ink" : "text-muted"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${index === 0 ? "bg-accent" : "bg-faint/50"}`} />
                          {label}
                        </span>
                        {count && <span className="text-accent2">{count}</span>}
                      </div>
                    ))}
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-[8px] uppercase tracking-wider text-faint">Labels</p>
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[9px] text-muted">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#6D4AFF]" /> Work
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] text-muted">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> Product
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] text-muted">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" /> Reading
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    {[
                      { from: "Ada Lovelace", subj: "Re: Welcome to NyxMail", time: "1m", dot: true, color: "#6D4AFF" },
                      { from: "Margaret Hamilton", subj: "Launch checklist for Friday", time: "2h", dot: true, color: "#14B8A6" },
                      { from: "Grace Hopper", subj: "The remarkable thing about backups", time: "1d", dot: false, color: "#F59E0B" },
                    ].map((item) => (
                      <div key={item.from} className="border-b border-border/70 px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                            style={{ backgroundColor: item.color }}
                          >
                            {item.from.split(" ").map((part) => part[0]).join("")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[10px] font-semibold text-ink">{item.from}</p>
                              <span className="text-[8px] text-faint">{item.time}</span>
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-muted">{item.subj}</p>
                            <div className="mt-1.5 flex items-center gap-1">
                              <LockKeyhole className="h-2.5 w-2.5 text-accent2/60" />
                              <span className="text-[8px] text-faint">Encrypted for you</span>
                              {item.dot && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-4">
                      <div className="rounded-lg border border-border bg-canvas p-3">
                        <div className="flex items-center gap-2 text-[9px] font-semibold text-ink">
                          <LockKeyhole className="h-3 w-3 text-accent2" /> Ciphertext preview
                          <span className="ml-auto rounded bg-success/10 px-1.5 py-0.5 text-[8px] text-success">
                            sealed
                          </span>
                        </div>
                        <div className="mt-2.5 space-y-1.5" aria-hidden="true">
                          <div className="h-1.5 w-full rounded bg-faint/15" />
                          <div className="h-1.5 w-5/6 rounded bg-faint/15" />
                          <div className="h-1.5 w-2/3 rounded bg-faint/15" />
                          <div className="h-1.5 w-3/4 rounded bg-faint/15" />
                        </div>
                        <p className="mt-2.5 font-mono text-[7px] leading-relaxed text-faint">
                          nyx1.9mXq…c2FsdA==.q8fJ2…4xYw==
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-border bg-canvas/50 px-4 py-2.5 text-[9px] text-faint">
                  <ShieldCheck className="h-3 w-3 text-success" /> Server-side readability: none
                  <span className="ml-auto">Storage 0.2 / 1.5 GB</span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="border-y border-border bg-surface/40">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 text-[11px] text-faint sm:px-6">
            <span className="inline-flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-accent2" /> X25519 + XSalsa20-Poly1305</span>
            <span className="inline-flex items-center gap-2"><KeyRound className="h-3.5 w-3.5 text-accent2" /> Argon2id</span>
            <span className="inline-flex items-center gap-2"><Fingerprint className="h-3.5 w-3.5 text-accent2" /> TOTP + WebAuthn</span>
            <span className="inline-flex items-center gap-2"><Database className="h-3.5 w-3.5 text-accent2" /> PostgreSQL + Prisma</span>
            <span className="hidden items-center gap-2 sm:inline-flex"><Terminal className="h-3.5 w-3.5 text-accent2" /> Node.js</span>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent2">Everything you expect</p>
            <h2 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
              A real mailbox, built around an unreasonable respect for privacy.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-border bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-soft"
              >
                <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent2">
                  {feature.icon}
                </span>
                <h3 className="text-[15px] font-semibold text-ink">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="security" className="relative overflow-hidden border-y border-border bg-surface/30 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent2">Key architecture</p>
                <h2 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
                  The server holds the envelope, never the letter.
                </h2>
                <p className="mt-5 text-sm leading-relaxed text-muted">
                  Each account gets an X25519 encryption keypair and an Ed25519 signing keypair. Your private
                  bundle is encrypted with a key derived from your password using Argon2id. The recovery kit
                  wraps the same bundle with an independent 24-word key.
                </p>
                <div className="mt-6 rounded-xl border border-warning/20 bg-warning/[0.06] p-3 text-[11px] leading-relaxed text-muted">
                  <span className="font-semibold text-warning">Nothing to reset.</span> If you lose both your
                  password and recovery kit, the mailbox cannot be decrypted. That is the trade-off for zero access.
                </div>
              </div>
              <div className="space-y-3">
                {flow.map((item) => (
                  <div key={item.step} className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
                    <div className="flex flex-col items-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent2">
                        {item.icon}
                      </span>
                      <span className="mt-2 text-[9px] font-semibold text-faint">{item.step}</span>
                    </div>
                    <div>
                      <h3 className="text-[14px] font-semibold text-ink">{item.title}</h3>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="migrate" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="grid items-center gap-10 rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-accent/[0.06] p-8 sm:p-12 lg:grid-cols-2">
            <div>
              <div className="chip mb-4 border-success/20 bg-success/[0.06] text-success">
                <Import className="h-3 w-3" /> Migration built in
              </div>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-ink">
                Your old mail doesn&apos;t have to stay behind.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                Connect Gmail with read-only OAuth, point NyxMail at any IMAP server, or drop in an
                mbox/EML archive. Every import is a resumable job with progress, ETA, pause and cancel.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Gmail", "IMAP", "mbox", "EML"].map((source) => (
                  <span key={source} className="chip">{source}</span>
                ))}
              </div>
              <Link href="/signup" className="btn btn-primary mt-7">
                Start your migration <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-2xl border border-border bg-canvas p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <Timer className="h-4 w-4 text-accent2" /> Gmail import
                </div>
                <span className="chip text-[10px]">Running</span>
              </div>
              <p className="mt-1 text-[11px] text-faint">Reading your archive · 2,184 of 8,430 messages</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-raised">
                <div className="h-full w-[26%] rounded-full bg-gradient-to-r from-accent to-accent2" />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-faint">
                <span>26%</span>
                <span>~12 min left</span>
              </div>
              <div className="mt-5 space-y-2">
                {[
                  ["Inbox", "1,842"],
                  ["Sent", "228"],
                  ["Archive", "114"],
                ].map(([folder, count]) => (
                  <div key={folder} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-[11px]">
                    <span className="text-muted">{folder}</span>
                    <span className="text-ink">{count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <span className="btn btn-secondary btn-sm flex-1">Pause</span>
                <span className="btn btn-ghost btn-sm flex-1">Cancel</span>
              </div>
            </div>
          </div>
        </section>

        <section id="self-host" className="border-y border-border bg-[#07090D] py-24 text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent2">Yours to run</p>
              <h2 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                One compose file away from owning your mail.
              </h2>
              <p className="mt-5 max-w-lg text-sm leading-relaxed text-white/50">
                NyxMail ships as a Next.js app, a background worker and a Prisma schema. Postgres is the only
                required service. Redis is optional for shared rate limiting across replicas.
              </p>
              <div className="mt-7 space-y-3">
                {[
                  "Docker Compose for local Postgres",
                  "Email-layer adapters for SMTP and MTA ingest",
                  "Haraka webhook plugin included for real MX delivery",
                  "Client-side IndexedDB search index and encrypted export",
                ].map((line) => (
                  <div key={line} className="flex items-center gap-2.5 text-[13px] text-white/60">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/10">
                      <Check className="h-3 w-3 text-success" />
                    </span>
                    {line}
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className="btn btn-primary">
                  Create an account <ChevronRight className="h-4 w-4" />
                </Link>
                {repositoryUrl ? (
                  <a
                    href={repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  >
                    <Github className="h-4 w-4" /> Source
                  </a>
                ) : null}
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 rounded-[2rem] bg-accent/10 blur-3xl" aria-hidden="true" />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0B0E14] shadow-soft">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  <span className="ml-3 font-mono text-[10px] text-white/30">terminal</span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[11.5px] leading-7 text-white/70">
{`$ cp .env.example .env
$ npm run keys:secrets   # JWT, crypto, ingest
$ docker compose up -d postgres
$ npm install
$ npm run db:migrate && npm run db:seed
$ npm run dev            # web on :3000
$ npm run dev:worker     # imports & scheduling

$ npm run demo:totp
  Current code: 123 456`}
                </pre>
                <div className="border-t border-white/10 px-5 py-3 font-mono text-[10px] text-white/30">
                  The demo credentials are printed by npm run db:seed
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-24">
          <div className="aurora pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
            <LogoMark className="mx-auto h-12 w-12" />
            <h2 className="mt-6 text-balance text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
              Private email isn&apos;t a feature. It&apos;s the architecture.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted">
              Start with the demo mailbox, plug in your domain, and move your archive when you&apos;re ready.
              The server will never hold enough to read your mail.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="btn btn-primary px-5 py-3">
                <Sparkles className="h-4 w-4" /> Create your inbox
              </Link>
              <Link href="/login" className="btn btn-secondary px-5 py-3">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <LogoMark className="h-5 w-5" />
            <span>NyxMail — private by construction.</span>
          </div>
          <div className="flex gap-5">
            <a href="#security" className="hover:text-muted">Security</a>
            <a href="#self-host" className="hover:text-muted">Self-hosting</a>
            <Link href="/login" className="hover:text-muted">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
