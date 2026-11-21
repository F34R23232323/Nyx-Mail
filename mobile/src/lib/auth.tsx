import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import {
  apiFetch,
  ApiError,
  loadBaseUrl,
  onUnauthorized,
  refreshSession,
  saveBaseUrl,
  setCsrfToken,
} from "./api";
import {
  setRandomSource,
  unlockKeyBundle,
  type KeyBundle,
} from "./crypto";
import type { KeyBundleResponse, UserDTO } from "./types";

// Wire expo-crypto's native CSPRNG into the pure-JS crypto layer immediately.
setRandomSource((length) => Crypto.getRandomBytes(length));

const LOCK_AFTER_BACKGROUND_MS = 5 * 60 * 1000;
const USER_CACHE_KEY = "nyxmail.cachedUser";

export type AuthStage = "booting" | "signedOut" | "mfa" | "locked" | "signedIn";

interface PendingMfa {
  token: string;
  methods: string[];
  email: string;
  displayName: string;
  password: string;
  hasPasskeys: boolean;
}

interface PendingSetup {
  token: string;
  qrDataUrl: string;
  otpauthUri: string;
  secret?: string;
  email: string;
  displayName: string;
  password: string;
}

interface AuthContextValue {
  stage: AuthStage;
  user: UserDTO | null;
  keys: KeyBundle | null;
  baseUrl: string;
  serverReady: boolean;
  pendingMfa: PendingMfa | null;
  pendingSetup: PendingSetup | null;
  unlockProgress: number;
  unlockBusy: boolean;
  error: string | null;
  backupCodes: string[] | null;
  clearBackupCodes: () => void;
  clearError: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  completeMfa: (code: string, method: "totp" | "backup") => Promise<void>;
  cancelMfa: () => void;
  completeSetup: (code: string) => Promise<string[]>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<UserDTO | null>;
  changeServer: (address: string) => Promise<void>;
  adoptSession: (user: UserDTO, keys: KeyBundle, csrf?: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<AuthStage>("booting");
  const [user, setUser] = useState<UserDTO | null>(null);
  const [keys, setKeys] = useState<KeyBundle | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [serverReady, setServerReady] = useState(false);
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  const [pendingSetup, setPendingSetup] = useState<PendingSetup | null>(null);
  const [unlockProgress, setUnlockProgress] = useState(0);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const backgroundAt = useRef<number | null>(null);
  const keysRef = useRef<KeyBundle | null>(null);
  keysRef.current = keys;

  const clearError = useCallback(() => setError(null), []);
  const clearBackupCodes = useCallback(() => setBackupCodes(null), []);

  const loadKeys = useCallback(
    async (password: string): Promise<KeyBundle> => {
      const data = await apiFetch<{ key: KeyBundleResponse }>("/api/v1/keys", {
        retryAuth: false,
      });
      setUnlockBusy(true);
      setUnlockProgress(0);
      try {
        const bundle = await unlockKeyBundle(
          data.key.encryptedPrivateKey,
          data.key.argonSalt,
          password,
          (fraction) => setUnlockProgress(Math.min(0.99, fraction)),
        );
        setUnlockProgress(1);
        return bundle;
      } finally {
        setUnlockBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    onUnauthorized(() => {
      setKeys(null);
      setUser(null);
      setStage("signedOut");
      setError("Your session expired. Sign in again to continue.");
    });
    return () => onUnauthorized(null);
  }, []);

  useEffect(() => {
    if (user) {
      void AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(user)).catch(() => undefined);
    } else {
      void AsyncStorage.removeItem(USER_CACHE_KEY).catch(() => undefined);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [stored, cachedRaw] = await Promise.all([
        loadBaseUrl(),
        AsyncStorage.getItem(USER_CACHE_KEY).catch(() => null),
      ]);
      if (!active) return;
      setBaseUrl(stored);
      setServerReady(true);

      // A fresh install has no server yet. Stay on the sign-in screen and let
      // the user choose one instead of firing requests at a relative URL.
      if (!stored) {
        setStage("signedOut");
        return;
      }

      let cached: UserDTO | null = null;
      if (cachedRaw) {
        try {
          const parsed = JSON.parse(cachedRaw) as UserDTO;
          if (parsed?.id && parsed?.email) cached = parsed;
        } catch {
          // ignore corrupt cache
        }
      }
      if (cached) {
        // Show the unlock screen immediately. Session validation continues in
        // the background and only sends the user back to sign-in on a real 401.
        setUser(cached);
        setStage("locked");
      }

      const loadSession = async (): Promise<"ok" | "unauthorized" | "network"> => {
        try {
          const data = await apiFetch<{ user: UserDTO; csrfToken: string | null }>(
            "/api/v1/auth/session",
            { retryAuth: false, timeoutMs: 12_000 },
          );
          if (!active) return "ok";
          setCsrfToken(data.csrfToken);
          setUser(data.user);
          setStage("locked");
          return "ok";
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            return "unauthorized";
          }
          return "network";
        }
      };

      const first = await loadSession();
      if (first === "ok" || !active) return;
      const refreshed = await refreshSession();
      if (!active) return;
      let second: "ok" | "unauthorized" | "network" | null = null;
      if (refreshed) {
        second = await loadSession();
        if (second === "ok" || !active) return;
      }

      if (!active) return;
      if (cached) {
        const invalid =
          (first === "unauthorized" && !refreshed) || second === "unauthorized";
        if (invalid) {
          setUser(null);
          setStage("signedOut");
        }
        return;
      }
      setStage("signedOut");
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        backgroundAt.current = Date.now();
      } else if (state === "active" && backgroundAt.current) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (away > LOCK_AFTER_BACKGROUND_MS && keysRef.current) {
          setKeys(null);
          setStage("locked");
        }
      }
    });
    return () => subscription.remove();
  }, []);

  const signIn = useCallback(async (rawEmail: string, password: string) => {
    setError(null);
    setUnlockProgress(0);
    const email = rawEmail.trim().toLowerCase();
    if (!email || !password) {
      setError("Enter your address and password.");
      return;
    }
    const data = await apiFetch<
      | {
          mfaRequired: true;
          mfaToken: string;
          methods: string[];
          hasPasskeys: boolean;
          email: string;
          displayName: string;
        }
      | {
          requiresSetup: true;
          setupToken: string;
          otpauthUri: string;
          qrDataUrl: string;
          email: string;
          displayName: string;
        }
    >("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      retryAuth: false,
    });

    if ("requiresSetup" in data) {
      setPendingSetup({
        token: data.setupToken,
        qrDataUrl: data.qrDataUrl,
        otpauthUri: data.otpauthUri,
        email: data.email,
        displayName: data.displayName,
        password,
      });
      setPendingMfa(null);
      setStage("mfa");
      return;
    }

    setPendingMfa({
      token: data.mfaToken,
      methods: data.methods,
      email: data.email,
      displayName: data.displayName,
      password,
      hasPasskeys: data.hasPasskeys,
    });
    setStage("mfa");
  }, []);

  const completeMfa = useCallback(
    async (code: string, method: "totp" | "backup") => {
      if (!pendingMfa) return;
      setError(null);
      const data = await apiFetch<{ user: UserDTO; csrfToken: string }>("/api/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({ method, mfaToken: pendingMfa.token, code: code.trim() }),
        retryAuth: false,
      });
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      const password = pendingMfa.password;
      try {
        const bundle = await loadKeys(password);
        setKeys(bundle);
        setPendingMfa(null);
        setStage("signedIn");
      } catch (caught) {
        setPendingMfa(null);
        setStage("locked");
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Signed in, but your encryption key could not be unlocked. Enter your password to unlock it.",
        );
      }
    },
    [loadKeys, pendingMfa],
  );

  const completeSetup = useCallback(
    async (code: string): Promise<string[]> => {
      if (!pendingSetup) return [];
      setError(null);
      const data = await apiFetch<{ user: UserDTO; backupCodes: string[]; csrfToken: string }>(
        "/api/v1/auth/two-factor/enable",
        {
          method: "POST",
          body: JSON.stringify({ setupToken: pendingSetup.token, code: code.trim() }),
          retryAuth: false,
        },
      );
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      const password = pendingSetup.password;
      setBackupCodes(data.backupCodes);
      try {
        const bundle = await loadKeys(password);
        setKeys(bundle);
        setPendingSetup(null);
        setStage("signedIn");
      } catch {
        setPendingSetup(null);
        setStage("locked");
      }
      return data.backupCodes;
    },
    [loadKeys, pendingSetup],
  );

  const unlock = useCallback(async (password: string) => {
    setError(null);
    try {
      const bundle = await loadKeys(password);
      setKeys(bundle);
      setStage("signedIn");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That password could not unlock your keys. Your mail stays encrypted.",
      );
      throw caught;
    }
  }, [loadKeys]);

  const lock = useCallback(() => {
    setKeys(null);
    setUnlockProgress(0);
    if (user) setStage("locked");
  }, [user]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST", retryAuth: false });
    } catch {
      // The session may already be gone; always clear local state.
    }
    setKeys(null);
    setUser(null);
    setCsrfToken(null);
    setPendingMfa(null);
    setPendingSetup(null);
    setStage("signedOut");
    setError(null);
    setBackupCodes(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: UserDTO }>("/api/v1/account", { retryAuth: true });
      setUser(data.user);
      return data.user;
    } catch {
      return null;
    }
  }, []);

  const changeServer = useCallback(
    async (address: string) => {
      const saved = await saveBaseUrl(address);
      setBaseUrl(saved);
      setKeys(null);
      setUser(null);
      setCsrfToken(null);
      setStage("signedOut");
      setError(null);
    },
    [],
  );

  const adoptSession = useCallback((nextUser: UserDTO, bundle: KeyBundle, csrf?: string | null) => {
    if (csrf) setCsrfToken(csrf);
    setUser(nextUser);
    setKeys(bundle);
    setStage("signedIn");
    setError(null);
  }, []);

  const cancelMfa = useCallback(() => {
    setPendingMfa(null);
    setPendingSetup(null);
    setError(null);
    setStage("signedOut");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      stage,
      user,
      keys,
      baseUrl,
      serverReady,
      pendingMfa,
      pendingSetup,
      unlockProgress,
      unlockBusy,
      error,
      backupCodes,
      clearBackupCodes,
      clearError,
      signIn,
      completeMfa,
      cancelMfa,
      completeSetup,
      unlock,
      lock,
      signOut,
      refreshUser,
      changeServer,
      adoptSession,
    }),
    [
      stage,
      user,
      keys,
      baseUrl,
      serverReady,
      pendingMfa,
      pendingSetup,
      unlockProgress,
      unlockBusy,
      error,
      backupCodes,
      clearBackupCodes,
      clearError,
      signIn,
      completeMfa,
      cancelMfa,
      completeSetup,
      unlock,
      lock,
      signOut,
      refreshUser,
      changeServer,
      adoptSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function useStoredServer(): [string, (value: string) => void] {
  const [value, setValue] = useState("");
  useEffect(() => {
    AsyncStorage.getItem("nyxmail.baseUrl")
      .then((stored) => stored && setValue(stored))
      .catch(() => undefined);
  }, []);
  return [value, setValue];
}
