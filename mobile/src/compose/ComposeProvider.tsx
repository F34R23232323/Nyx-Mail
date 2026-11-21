import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { DecryptedMail } from "../lib/types";
import { ComposeScreen } from "../screens/mail/ComposeScreen";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposeSeed {
  mode: ComposeMode;
  source?: DecryptedMail;
  threadId?: string | null;
  subject?: string;
  to?: { email: string; name?: string }[];
}

interface ComposeContextValue {
  open: (seed?: ComposeSeed) => void;
  close: () => void;
  isOpen: boolean;
}

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [seed, setSeed] = useState<ComposeSeed | null>(null);
  const [openKey, setOpenKey] = useState(0);

  const open = useCallback((next?: ComposeSeed) => {
    setSeed(next ?? { mode: "new" });
    setOpenKey((value) => value + 1);
  }, []);

  const close = useCallback(() => setSeed(null), []);

  const value = useMemo(
    () => ({ open, close, isOpen: seed !== null }),
    [close, open, seed],
  );

  return (
    <ComposeContext.Provider value={value}>
      {children}
      {seed ? <ComposeScreen key={openKey} seed={seed} onClose={close} /> : null}
    </ComposeContext.Provider>
  );
}

export function useCompose(): ComposeContextValue {
  const context = useContext(ComposeContext);
  if (!context) throw new Error("useCompose must be used inside ComposeProvider");
  return context;
}
