import nodemailer from "nodemailer";
import { prisma } from "@nyxmail/db";
import { decryptJson } from "@nyxmail/shared/secrets";
import { normalizeEmail } from "@nyxmail/shared";
import type { OutboundMessage } from "./transport";

/**
 * Sends through a connected Gmail account using the Gmail API. The account's
 * refresh token is stored encrypted by the web app; sending requires the
 * `gmail.send` scope, which is granted during the "connect Gmail" flow.
 *
 * External recipients are sent from Gmail, so Google and the recipient see the
 * plaintext exactly as with any Gmail message. NyxMail still keeps its own
 * encrypted Sent copy. Internal NyxMail recipients are delivered separately by
 * the encrypted local pipeline and are deliberately excluded from this MIME
 * message so they never receive a duplicate plaintext copy through Google.
 */
export class GmailSendError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "gmail_error",
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}

export interface GmailSendAccount {
  id: string;
  googleEmail: string;
  credentials: string;
}

interface GmailCredentials {
  refreshToken?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

function googleClient(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!id || !secret) {
    throw new GmailSendError(
      503,
      "Gmail sending is not configured on this server",
      "gmail_unconfigured",
    );
  }
  return { id, secret };
}

async function accessTokenFor(refreshToken: string, force = false): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }
  const { id, secret } = googleClient();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!response) {
    throw new GmailSendError(502, "Could not reach Google to send this Gmail message", "gmail_network");
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new GmailSendError(
      403,
      "Reconnect this Gmail account to restore sending access",
      "gmail_reconnect",
    );
  }
  tokenCache.set(refreshToken, {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

async function buildRawMessage(message: OutboundMessage): Promise<string> {
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const info = await transporter.sendMail({
    from: { name: message.from.name, address: normalizeEmail(message.from.email) },
    to: message.to.map((address) => ({ name: address.name, address: normalizeEmail(address.email) })),
    cc: message.cc.map((address) => ({ name: address.name, address: normalizeEmail(address.email) })),
    bcc: message.bcc.map((address) => ({ name: address.name, address: normalizeEmail(address.email) })),
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.mimeType,
      cid: attachment.cid ?? undefined,
    })),
    inReplyTo: message.inReplyTo ?? undefined,
    references: message.references ?? undefined,
    headers: message.headers,
  });
  const raw = info.message as unknown as Buffer;
  return raw.toString("base64url");
}

interface GmailApiResult {
  id?: string;
  threadId?: string;
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

async function callGmail(accessToken: string, raw: string): Promise<Response> {
  return fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
    cache: "no-store",
  });
}

export async function sendGmailMessage(
  userId: string,
  account: GmailSendAccount,
  message: OutboundMessage,
): Promise<{ id: string; provider: "gmail" }> {
  const recipients = [...message.to, ...message.cc, ...message.bcc].map((address) => ({
    email: normalizeEmail(address.email),
    name: address.name,
  }));
  const logFailure = async (detail: string): Promise<void> => {
    await prisma.transportLog
      .create({
        data: {
          userId,
          provider: "gmail",
          toAddresses: recipients,
          subject: null,
          status: "FAILED",
          error: detail.slice(0, 4000),
        },
      })
      .catch(() => undefined);
  };

  try {
    const credentials = decryptJson<GmailCredentials>(account.credentials);
    if (!credentials.refreshToken) {
      throw new GmailSendError(
        403,
        "Reconnect this Gmail account to restore sending access",
        "gmail_reconnect",
      );
    }
    let token = await accessTokenFor(credentials.refreshToken);
    const raw = await buildRawMessage(message);
    let response = await callGmail(token, raw);
    if (response.status === 401) {
      token = await accessTokenFor(credentials.refreshToken, true);
      response = await callGmail(token, raw);
    }
    const body = (await response.json().catch(() => ({}))) as GmailApiResult;
    if (!response.ok) {
      const reason = body.error?.errors?.map((entry) => entry.reason).filter(Boolean).join(",") ?? "";
      const detail = body.error?.message || `Gmail rejected the message (${response.status})`;
      if (response.status === 401) {
        throw new GmailSendError(
          403,
          "Reconnect this Gmail account to restore sending access",
          "gmail_reconnect",
        );
      }
      if (response.status === 403) {
        throw new GmailSendError(
          403,
          "Grant Gmail send permission by reconnecting this account in the From menu",
          "gmail_send_scope",
        );
      }
      throw new GmailSendError(
        response.status >= 500 ? 502 : 400,
        reason ? `${detail} (${reason})` : detail,
        "gmail_error",
      );
    }
    const resultId = body.id || `gmail-${Date.now()}`;
    await prisma.transportLog
      .create({
        data: {
          userId,
          provider: "gmail",
          toAddresses: recipients,
          subject: null,
          messageId: resultId,
          status: "SENT",
          preview: `Gmail · ${account.googleEmail}`,
        },
      })
      .catch(() => undefined);
    return { id: resultId, provider: "gmail" };
  } catch (error) {
    if (error instanceof GmailSendError) {
      await logFailure(error.message);
      throw error;
    }
    const detail = error instanceof Error ? error.message : "Gmail send failed";
    await logFailure(detail);
    throw new GmailSendError(502, detail, "gmail_error");
  }
}

/** Used by the mobile deep-link flow to reject accounts without send scope early. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
