"use client";

import { Suspense } from "react";
import { MailApp } from "@/components/mail/MailApp";
import { Logo } from "@/components/ui/Logo";

function MailLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
          Opening your encrypted mailbox…
        </div>
      </div>
    </div>
  );
}

export default function MailPage() {
  return (
    <Suspense fallback={<MailLoading />}>
      <MailApp />
    </Suspense>
  );
}
