"use client";

import { Suspense } from "react";
import { SettingsApp } from "@/components/settings/SettingsApp";
import { Logo } from "@/components/ui/Logo";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas">
          <div className="flex flex-col items-center gap-4">
            <Logo />
            <p className="text-[11px] text-faint">Loading settings…</p>
          </div>
        </div>
      }
    >
      <SettingsApp />
    </Suspense>
  );
}
