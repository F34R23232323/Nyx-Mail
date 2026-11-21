"use client";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, "credentials"> {
  retryAuth?: boolean;
  redirectOnAuthFailure?: boolean;
}

let refreshPromise: Promise<boolean> | null = null;

function cookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function triggerUnauthorized(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("nyxmail:unauthorized"));
  if (!window.location.pathname.startsWith("/login")) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
  }
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch("/api/v1/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        });
        return response.ok;
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

const AUTH_EXEMPT = [
  "/api/v1/auth/login",
  "/api/v1/auth/signup",
  "/api/v1/auth/verify",
  "/api/v1/auth/refresh",
  "/api/v1/auth/recovery",
  "/api/v1/auth/two-factor",
];

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const {
    retryAuth = true,
    redirectOnAuthFailure = true,
    headers,
    method = "GET",
    ...rest
  } = options;
  const upperMethod = method.toUpperCase();
  const requestHeaders = new Headers(headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(upperMethod)) {
    const csrf = cookie("nyx_csrf");
    if (csrf) requestHeaders.set("x-csrf-token", csrf);
    if (!(rest.body instanceof FormData) && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      method: upperMethod,
      headers: requestHeaders,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    throw new ApiClientError(
      0,
      error instanceof Error ? "Network unavailable. Check your connection." : "Network error",
      "network_error",
    );
  }

  if (
    response.status === 401 &&
    retryAuth &&
    !AUTH_EXEMPT.some((prefix) => path.startsWith(prefix))
  ) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, retryAuth: false });
    }
    if (redirectOnAuthFailure) triggerUnauthorized();
  }

  const contentType = response.headers.get("content-type") || "";
  let body: unknown = null;
  if (response.status !== 204) {
    if (contentType.includes("application/json")) {
      body = await response.json().catch(() => null);
    } else {
      body = await response.text().catch(() => "");
    }
  }

  if (!response.ok) {
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof body === "string" && body
          ? body.slice(0, 200)
          : `Request failed (${response.status})`;
    const error = new ApiClientError(
      response.status,
      message,
      typeof payload.code === "string" ? payload.code : "error",
      payload.details,
    );
    if (response.status === 401 && redirectOnAuthFailure && retryAuth) {
      // handled above for retryable paths
    }
    throw error;
  }

  return body as T;
}

export function setUserFromCookieless(): void {
  // Session cookie is httpOnly; nothing to store client-side.
}

export async function fetchWithSession<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiFetch<T>(path, options);
}

export function getCsrfToken(): string | null {
  return cookie("nyx_csrf");
}

export async function uploadEncryptedAttachment(input: {
  ciphertext: Uint8Array;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string | null;
  inline?: boolean;
}): Promise<{ attachment: { blobId: string; filename: string; mimeType: string; sizeBytes: number } }> {
  const form = new FormData();
  const buffer = new Uint8Array(input.ciphertext);
  form.append("file", new Blob([buffer], { type: "application/octet-stream" }), `${input.filename}.nyx`);
  form.append("filename", input.filename);
  form.append("mimeType", input.mimeType);
  form.append("sizeBytes", String(input.sizeBytes));
  form.append("inline", input.inline ? "true" : "false");
  if (input.contentId) form.append("contentId", input.contentId);
  return apiFetch("/api/v1/attachments", { method: "POST", body: form });
}

export async function downloadAttachment(blobId: string): Promise<ArrayBuffer> {
  const response = await fetch(`/api/v1/attachments/${encodeURIComponent(blobId)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new ApiClientError(response.status, "Attachment could not be downloaded");
  return response.arrayBuffer();
}
