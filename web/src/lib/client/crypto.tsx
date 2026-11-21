"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { KeyBundleResponse } from "@nyxmail/shared";
import { unlockKeyBundle, type KeyBundle } from "@nyxmail/crypto";
import { apiFetch } from "./api";

interface CryptoContextValue {
  bundle: KeyBundle | null;
  privateKey: string | null;
  publicKey: string | null;
  signingPublicKey: string | null;
  ready: boolean;
  setBundle: (bundle: KeyBundle) => void;
  unlockWithPassword: (password: string) => Promise<KeyBundle>;
  lock: () => void;
}

const CryptoContext = createContext<CryptoContextValue | null>(null);
const SESSION_KEY = "nyxmail-unlocked-bundle";

function readStoredBundle(): KeyBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KeyBundle;
    return parsed?.version === 1 && parsed.privateKey && parsed.publicKey ? parsed : null;
  } catch {
    return null;
  }
}

function persistBundle(bundle: KeyBundle | null): void {
  if (typeof window === "undefined") return;
  try {
    if (bundle) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(bundle));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage may be unavailable in private/restricted browser modes.
  }
}

export function CryptoProvider({ children }: { children: ReactNode }) {
  const [bundle, setBundleState] = useState<KeyBundle | null>(null);

  useEffect(() => {
    const stored = readStoredBundle();
    if (stored) setBundleState(stored);
    const lock = () => {
      setBundleState(null);
      persistBundle(null);
    };
    window.addEventListener("nyxmail:lock", lock);
    window.addEventListener("nyxmail:unauthorized", lock);
    return () => {
      window.removeEventListener("nyxmail:lock", lock);
      window.removeEventListener("nyxmail:unauthorized", lock);
    };
  }, []);

  const setBundle = useCallback((next: KeyBundle) => {
    setBundleState(next);
    persistBundle(next);
  }, []);
  const lock = useCallback(() => {
    setBundleState(null);
    persistBundle(null);
  }, []);

  const unlockWithPassword = useCallback(async (password: string) => {
    const data = await apiFetch<{ key: KeyBundleResponse }>("/api/v1/keys");
    const unlocked = await unlockKeyBundle(
      data.key.encryptedPrivateKey,
      data.key.argonSalt,
      password,
    );
    setBundleState(unlocked);
    persistBundle(unlocked);
    return unlocked;
  }, []);

  const value = useMemo<CryptoContextValue>(
    () => ({
      bundle,
      privateKey: bundle?.privateKey ?? null,
      publicKey: bundle?.publicKey ?? null,
      signingPublicKey: bundle?.signingPublicKey ?? null,
      ready: Boolean(bundle),
      setBundle,
      unlockWithPassword,
      lock,
    }),
    [bundle, setBundle, unlockWithPassword, lock],
  );

  return <CryptoContext.Provider value={value}>{children}</CryptoContext.Provider>;
}

export function useCrypto(): CryptoContextValue {
  const context = useContext(CryptoContext);
  if (!context) throw new Error("useCrypto must be used inside CryptoProvider");
  return context;
}
