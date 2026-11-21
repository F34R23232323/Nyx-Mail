import * as WebBrowser from "expo-web-browser";
import { apiFetch } from "./api";

/**
 * Opens Google's consent screen in a secure browser session and returns to the
 * app via the custom scheme. The server receives the OAuth callback without
 * needing a browser-side NyxMail session; the signed state token carries the
 * account identity and the mobile flag.
 */
export async function connectGmailForSending(): Promise<{ email?: string } | null> {
  const data = await apiFetch<{ url: string }>("/api/v1/imports/gmail/connect-url");
  const result = await WebBrowser.openAuthSessionAsync(
    data.url,
    "nyxmail://gmail-connected",
  );
  if (result.type !== "success" || !result.url) return null;
  const url = new URL(result.url);
  if (url.protocol !== "nyxmail:") return null;
  if (url.hostname === "gmail-error") {
    throw new Error(url.searchParams.get("message") || "Gmail connection failed");
  }
  return { email: url.searchParams.get("email") ?? undefined };
}
