import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 text-center">
      <Logo />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent2">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This page is not in your mailbox</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">
          The page may have moved, or it was never here. Your messages are safe.
        </p>
      </div>
      <Link href="/" className="btn btn-primary">
        Return home
      </Link>
    </main>
  );
}
