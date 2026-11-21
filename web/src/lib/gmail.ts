import { createHash, randomBytes } from "node:crypto";
import { appUrl, optionalEnv } from "./env";
import { signFlowToken, verifyFlowToken } from "./auth";

// Import needs read access, while sending from a connected Gmail identity goes
// through the Gmail API. Existing accounts must re-consent once to gain send
// permission; the mobile connect flow requests both scopes in one step.
const GMAIL_SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

export function isGmailConfigured(): boolean {
  return Boolean(optionalEnv("GOOGLE_CLIENT_ID") && optionalEnv("GOOGLE_CLIENT_SECRET"));
}

function redirectUri(): string {
  return (
    optionalEnv("GOOGLE_REDIRECT_URI") ||
    `${appUrl()}/api/v1/imports/gmail/callback`
  );
}

export async function buildGmailAuthUrl(
  userId: string,
  options: { mobile?: boolean } = {},
): Promise<string> {
  const clientId = optionalEnv("GOOGLE_CLIENT_ID");
  if (!clientId) throw new Error("Gmail import is not configured");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = await signFlowToken({
    userId,
    purpose: "gmail_state",
    data: { verifier, mobile: Boolean(options.mobile) },
    expiresIn: "15m",
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function gmailProfileEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { emailAddress?: string };
    return typeof data.emailAddress === "string" ? data.emailAddress : undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeGmailCode(
  code: string,
  stateToken: string,
): Promise<{ userId: string; tokens: GmailTokens; mobile: boolean }> {
  const { userId, data } = await verifyFlowToken(stateToken, "gmail_state");
  const mobile = data.mobile === true;
  const verifier = typeof data.verifier === "string" ? data.verifier : "";
  const clientId = optionalEnv("GOOGLE_CLIENT_ID");
  const clientSecret = optionalEnv("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Gmail import is not configured");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(body.error_description || body.error || "Google did not return an offline token");
  }
  return {
    userId,
    mobile,
    tokens: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      email: await gmailProfileEmail(body.access_token),
    },
  };
}

export async function gmailStateIsMobile(stateToken: string | null): Promise<boolean> {
  if (!stateToken) return false;
  try {
    const { data } = await verifyFlowToken(stateToken, "gmail_state");
    return data.mobile === true;
  } catch {
    return false;
  }
}
