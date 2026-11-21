import type { Address } from "@nyxmail/shared";
import { decryptJson, encryptJson } from "@nyxmail/shared/secrets";
import type { OutboundAttachment, OutboundMessage } from "./transport";

/**
 * Scheduled external sends need the relay to see plaintext at send time.
 * The payload is AES-256-GCM encrypted at rest with APP_ENCRYPTION_KEY until
 * the worker releases it. It is deleted (or marked SENT) immediately after.
 */
export interface ScheduledRelayPayload {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  text: string;
  attachments: Array<OutboundAttachment & { contentBase64: string }>;
  inReplyTo?: string | null;
  references?: string[];
}

export function sealScheduledPayload(payload: ScheduledRelayPayload): string {
  return encryptJson(payload);
}

export function openScheduledPayload(ciphertext: string): ScheduledRelayPayload {
  return decryptJson<ScheduledRelayPayload>(ciphertext);
}

export function scheduledToOutbound(payload: ScheduledRelayPayload): OutboundMessage {
  return {
    from: payload.from,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      content: Buffer.from(attachment.contentBase64, "base64"),
      cid: attachment.cid,
    })),
    inReplyTo: payload.inReplyTo,
    references: payload.references,
  };
}
