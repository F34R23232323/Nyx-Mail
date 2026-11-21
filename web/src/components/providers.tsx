"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/lib/client/theme";
import { ToastProvider } from "@/lib/client/toast";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { AuthProvider } from "@/lib/client/auth";
import { CryptoProvider } from "@/lib/client/crypto";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <CryptoProvider>{children}</CryptoProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
