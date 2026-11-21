import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { toBase64 } from "./crypto";

const BASE_URL_KEY = "nyxmail.baseUrl";
// Self-hosted builds can set EXPO_PUBLIC_NYXMAIL_URL at bundle time. When it is
// empty, the login screen asks the user for the server address.
export const DEFAULT_BASE_URL = (process.env.EXPO_PUBLIC_NYXMAIL_URL || "")
  .trim()
  .replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new ApiError(0, "Enter a server address", "invalid_url");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ApiError(0, "That does not look like a valid server address", "invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiError(0, "Use an http(s) server address", "invalid_url");
  }
  return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, ""));
}

let baseUrl = DEFAULT_BASE_URL;
let baseUrlLoaded = false;
let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function getBaseUrl(): string {
  return baseUrl;
}

export async function loadBaseUrl(): Promise<string> {
  if (baseUrlLoaded) return baseUrl;
  try {
    const stored = await AsyncStorage.getItem(BASE_URL_KEY);
    if (stored) baseUrl = normalizeBaseUrl(stored);
  } catch {
    // keep the build-time default or prompt for a server on the login screen
  }
  baseUrlLoaded = true;
  return baseUrl;
}

export async function saveBaseUrl(value: string): Promise<string> {
  const next = normalizeBaseUrl(value);
  baseUrl = next;
  baseUrlLoaded = true;
  await AsyncStorage.setItem(BASE_URL_KEY, next).catch(() => undefined);
  return next;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const AUTH_EXEMPT = [
  "/api/v1/auth/login",
  "/api/v1/auth/signup",
  "/api/v1/auth/verify",
  "/api/v1/auth/refresh",
  "/api/v1/auth/recovery",
  "/api/v1/auth/two-factor",
  "/api/v1/auth/session",
];

interface RequestOptions extends Omit<RequestInit, "credentials"> {
  retryAuth?: boolean;
  timeoutMs?: number;
}

async function rawFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { headers, method = "GET", retryAuth, timeoutMs = 30_000, ...rest } = options;
  const upperMethod = method.toUpperCase();
  const requestHeaders = new Headers(headers as HeadersInit | undefined);
  requestHeaders.set("Accept", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(upperMethod)) {
    if (csrfToken) requestHeaders.set("x-csrf-token", csrfToken);
    if (!(rest.body instanceof FormData) && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }
  }
  requestHeaders.set("x-nyx-client", "mobile/1.0");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...rest,
      method: upperMethod,
      headers: requestHeaders,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ApiError(0, "The server took too long to respond", "timeout");
    }
    throw new ApiError(
      0,
      "Cannot reach the mail server. Check your connection and the server address.",
      "network_error",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retryAuth = true, ...rest } = options;
  let response = await rawFetch(path, options);

  const exempt = AUTH_EXEMPT.some((prefix) => path.startsWith(prefix));
  if (response.status === 401 && retryAuth && !exempt) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await rawFetch(path, { ...rest, retryAuth: false });
    } else {
      unauthorizedHandler?.();
    }
  }

  const body = await parseBody(response);

  if (!response.ok) {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof body === "string" && body
          ? body.slice(0, 240)
          : `Request failed (${response.status})`;
    throw new ApiError(
      response.status,
      message,
      typeof payload.code === "string" ? payload.code : "error",
      payload.details,
    );
  }

  return body as T;
}

export async function apiFetchBytes(
  path: string,
  options: RequestOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { retryAuth = true, ...rest } = options;
  let response = await rawFetch(path, options);
  const exempt = AUTH_EXEMPT.some((prefix) => path.startsWith(prefix));
  if (response.status === 401 && retryAuth && !exempt) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await rawFetch(path, { ...rest, retryAuth: false });
    } else {
      unauthorizedHandler?.();
    }
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // binary or empty response
    }
    throw new ApiError(response.status, message, "binary_request_failed");
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: (response.headers.get("content-type") || "image/png").split(";")[0],
  };
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await rawFetch("/api/v1/auth/refresh", { method: "POST", timeoutMs: 20_000 });
        const body = (await parseBody(response)) as { csrfToken?: string; user?: unknown } | null;
        if (!response.ok) return false;
        if (body && typeof body.csrfToken === "string") csrfToken = body.csrfToken;
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

export async function probeServer(address: string): Promise<{
  baseUrl: string;
  signupDomains: string[];
}> {
  const previous = baseUrl;
  const next = normalizeBaseUrl(address);
  baseUrl = next;
  try {
    const data = await apiFetch<{ signupDomains?: string[] }>("/api/v1/config", {
      retryAuth: false,
      timeoutMs: 12_000,
    });
    return { baseUrl: next, signupDomains: data.signupDomains ?? [] };
  } catch (error) {
    baseUrl = previous;
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(0, "That server is not running NyxMail", "not_nyxmail");
    }
    throw error;
  }
}

export async function uploadEncryptedAttachment(input: {
  ciphertext: Uint8Array;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string | null;
  inline?: boolean;
}): Promise<{ attachment: { blobId: string; filename: string; mimeType: string; sizeBytes: number } }> {
  const tempPath = `${FileSystem.cacheDirectory}upload-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.nyx`;
  await FileSystem.writeAsStringAsync(tempPath, toBase64(input.ciphertext), {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    const form = new FormData();
    form.append("file", {
      uri: tempPath,
      name: `${input.filename}.nyx`,
      type: "application/octet-stream",
    } as unknown as Blob);
    form.append("filename", input.filename);
    form.append("mimeType", input.mimeType);
    form.append("sizeBytes", String(input.sizeBytes));
    form.append("inline", input.inline ? "true" : "false");
    if (input.contentId) form.append("contentId", input.contentId);
    return await apiFetch("/api/v1/attachments", { method: "POST", body: form, timeoutMs: 120_000 });
  } finally {
    FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => undefined);
  }
}

export async function downloadAttachment(blobId: string): Promise<Uint8Array> {
  const response = await rawFetch(`/api/v1/attachments/${encodeURIComponent(blobId)}`, {
    timeoutMs: 120_000,
  });
  if (!response.ok) throw new ApiError(response.status, "Attachment could not be downloaded");
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
