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
import type { UserDTO } from "@nyxmail/shared";
import { apiFetch, ApiClientError } from "./api";

interface AuthContextValue {
  user: UserDTO | null;
  loading: boolean;
  setUser: (user: UserDTO | null) => void;
  refreshUser: () => Promise<UserDTO | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await apiFetch<{ user: UserDTO }>("/api/v1/auth/session", {
          redirectOnAuthFailure: false,
          retryAuth: false,
        });
        if (active) setUserState(data.user);
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          const refreshed = await apiFetch<{ user: UserDTO }>("/api/v1/auth/refresh", {
            method: "POST",
            redirectOnAuthFailure: false,
            retryAuth: false,
          }).catch(() => null);
          if (active && refreshed?.user) setUserState(refreshed.user);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUserState(null);
      window.dispatchEvent(new Event("nyxmail:lock"));
    };
    window.addEventListener("nyxmail:unauthorized", onUnauthorized);
    return () => window.removeEventListener("nyxmail:unauthorized", onUnauthorized);
  }, []);

  const setUser = useCallback((next: UserDTO | null) => setUserState(next), []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: UserDTO }>("/api/v1/account", {
        redirectOnAuthFailure: false,
      });
      setUserState(data.user);
      return data.user;
    } catch {
      return null;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Clear client state even if the session was already invalid.
    }
    setUserState(null);
    window.dispatchEvent(new Event("nyxmail:lock"));
    window.location.assign("/login");
  }, []);

  const value = useMemo(
    () => ({ user, loading, setUser, refreshUser, logout }),
    [user, loading, setUser, refreshUser, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
