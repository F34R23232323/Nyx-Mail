import { readFileSync } from "node:fs";
import { resolveMx } from "node:dns/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import nodemailer, { type DKIMOptions, type Transporter } from "nodemailer";
import { prisma } from "@nyxmail/db";
import type { Address } from "@nyxmail/shared";
import { formatAddress, normalizeEmail } from "@nyxmail/shared";
import { defaultDkimSelector, domainDkimKey } from "./domains";

export interface OutboundAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
  cid?: string | null;
}

export interface OutboundMessage {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  text: string;
  attachments: OutboundAttachment[];
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
  /** SMTP envelope can differ from the visible To/Cc headers when some
   * recipients are hosted locally and delivered directly. */
  envelope?: { from: string; to: string[] };
}

export interface TransportResult {
  id: string;
  provider: string;
  preview?: string;
}

export interface MailTransportProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<TransportResult>;
}

export class ConsoleProvider implements MailTransportProvider {
  readonly name = "console";

  async send(message: OutboundMessage): Promise<TransportResult> {
    return {
      id: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider: this.name,
      preview: "Console delivery (development mode; no SMTP configured)",
    };
  }
}

const dkimKeyCache = new Map<string, string | null>();
const dkimWarningShown = new Set<string>();

function dkimKeyDirectories(): string[] {
  const configured = process.env.DKIM_KEY_DIR?.trim();
  const candidates = [
    configured,
    resolve(process.cwd(), "config", "dkim"),
    resolve(process.cwd(), "..", "config", "dkim"),
    resolve(process.cwd(), "../..", "config", "dkim"),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

/**
 * Sign outbound mail with the instance's own DKIM key when one is available.
 * Domains added in Settings → Domains keep an encrypted key in the database;
 * existing installations can still use config/dkim/<domain>.private. This
 * keeps the visible From domain aligned even when the outbound relay
 * (Resend, SES, etc.) has no DKIM selector of its own published for the domain.
 */
async function outboundDkimOptions(sender: Address): Promise<DKIMOptions | undefined> {
  const domain = normalizeEmail(sender.email).split("@").pop() || "";
  if (!domain || !domain.includes(".") || !/^[a-z0-9.-]+$/i.test(domain)) return undefined;

  const storedKey = await domainDkimKey(domain);
  if (storedKey) {
    return {
      domainName: domain,
      keySelector: storedKey.selector,
      privateKey: storedKey.privateKey,
      headerFieldNames: "from:to:cc:subject:date:reply-to",
    };
  }

  let privateKey = dkimKeyCache.get(domain);
  if (privateKey === undefined) {
    for (const keyDir of dkimKeyDirectories()) {
      try {
        privateKey = readFileSync(resolve(keyDir, `${domain}.private`), "utf8").trim() || null;
        if (privateKey) break;
      } catch {
        // Try the next candidate location.
      }
    }
    privateKey ??= null;
    dkimKeyCache.set(domain, privateKey);
  }
  if (!privateKey) {
    if (!dkimWarningShown.has(domain)) {
      dkimWarningShown.add(domain);
      console.warn(
        `[nyxmail] outbound DKIM key not found for ${domain}; sending unsigned`,
      );
    }
    return undefined;
  }

  return {
    domainName: domain,
    keySelector: defaultDkimSelector(),
    privateKey,
    headerFieldNames: "from:to:cc:subject:date:reply-to",
  };
}

export class SMTPProvider implements MailTransportProvider {
  readonly name = "smtp";
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      password?: string;
      from: string;
    },
  ) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth:
          this.config.user && this.config.password
            ? { user: this.config.user, pass: this.config.password }
            : undefined,
        pool: true,
        maxConnections: 3,
        connectionTimeout: 20_000,
        socketTimeout: 60_000,
        tls: {
          rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
        },
      });
    }
    return this.transporter;
  }

  async send(message: OutboundMessage): Promise<TransportResult> {
    const dkim = await outboundDkimOptions(message.from);
    const info = await this.getTransporter().sendMail({
      from: formatAddress(message.from),
      ...(dkim ? { dkim } : {}),
      to: message.to.map(formatAddress),
      cc: message.cc.map(formatAddress),
      bcc: message.bcc.map(formatAddress),
      replyTo: formatAddress(message.from),
      subject: message.subject,
      html: message.html,
      text: message.text,
      inReplyTo: message.inReplyTo ?? undefined,
      references: message.references,
      headers: message.headers,
      envelope: message.envelope,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.mimeType,
        content: attachment.content,
        cid: attachment.cid ?? undefined,
      })),
    });
    return { id: info.messageId, provider: this.name };
  }
}

function isPermanentSmtpError(error: unknown): boolean {
  const code = (error as { responseCode?: number } | null)?.responseCode;
  return typeof code === "number" && code >= 500 && code < 600;
}

async function recipientMxHosts(domain: string): Promise<string[]> {
  try {
    const records = await resolveMx(domain);
    const hosts = records
      .sort((a, b) => a.priority - b.priority)
      .map((record) => record.exchange.replace(/\.$/, ""))
      .filter(Boolean);
    if (hosts.length > 0) return hosts;
  } catch {
    // Fall back to the domain's address records when the domain has no MX.
  }
  return [domain];
}

/**
 * Deliver directly to recipient MX servers from this host. No third-party
 * relay is involved. The public IPv4 address (with matching PTR/SPF) and the
 * instance DKIM key are used to satisfy SPF and DMARC.
 */
export class DirectSMTPProvider implements MailTransportProvider {
  readonly name = "direct";

  constructor(
    private readonly config: {
      localAddress?: string;
      helo: string;
      port: number;
      requireTls: boolean;
    },
  ) {}

  private mailOptions(message: OutboundMessage, envelopeTo: string[], dkim?: DKIMOptions) {
    return {
      from: formatAddress(message.from),
      to: message.to.map(formatAddress),
      cc: message.cc.map(formatAddress),
      replyTo: formatAddress(message.from),
      subject: message.subject,
      html: message.html,
      text: message.text,
      inReplyTo: message.inReplyTo ?? undefined,
      references: message.references,
      headers: message.headers,
      envelope: {
        from: message.envelope?.from || message.from.email,
        to: envelopeTo,
      },
      ...(dkim ? { dkim } : {}),
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.mimeType,
        content: attachment.content,
        cid: attachment.cid ?? undefined,
      })),
    };
  }

  async send(message: OutboundMessage): Promise<TransportResult> {
    const recipients = Array.from(
      new Set(
        (message.envelope?.to?.length
          ? message.envelope.to
          : [...message.to, ...message.cc, ...message.bcc].map((address) => address.email)
        ).map(normalizeEmail),
      ),
    ).filter(Boolean);

    if (recipients.length === 0) {
      throw new Error("Direct delivery has no recipients");
    }

    const byDomain = new Map<string, string[]>();
    for (const address of recipients) {
      const domain = address.split("@").pop();
      if (!domain) continue;
      const group = byDomain.get(domain);
      if (group) group.push(address);
      else byDomain.set(domain, [address]);
    }

    const dkim = await outboundDkimOptions(message.from);
    let firstMessageId = "";
    const delivered: string[] = [];

    for (const [domain, envelopeTo] of byDomain) {
      const hosts = await recipientMxHosts(domain);
      let lastError: unknown = null;

      for (const host of hosts) {
        const transporter = nodemailer.createTransport({
          host,
          port: this.config.port,
          secure: false,
          name: this.config.helo,
          ...(this.config.localAddress ? { localAddress: this.config.localAddress } : {}),
          requireTLS: this.config.requireTls,
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 60_000,
          tls: { rejectUnauthorized: true },
        });

        try {
          const info = await transporter.sendMail(this.mailOptions(message, envelopeTo, dkim));
          firstMessageId ||= info.messageId || "";
          delivered.push(...envelopeTo);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (isPermanentSmtpError(error)) break;
        } finally {
          transporter.close();
        }
      }

      if (lastError) {
        const detail = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Direct delivery to ${domain} failed: ${detail}`);
      }
    }

    return {
      id: firstMessageId || `direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider: this.name,
      preview: `Direct delivery to ${delivered.length} recipient${delivered.length === 1 ? "" : "s"}`,
    };
  }
}

let provider: MailTransportProvider | null = null;

export function getTransportProvider(): MailTransportProvider {
  if (provider) return provider;
  const mode = process.env.OUTBOUND_TRANSPORT?.trim().toLowerCase();
  const host = process.env.SMTP_HOST?.trim();

  if (mode === "direct") {
    provider = new DirectSMTPProvider({
      localAddress: process.env.SMTP_DIRECT_LOCAL_ADDRESS?.trim() || undefined,
      helo: process.env.SMTP_DIRECT_HELO?.trim() || process.env.MAIL_HOSTNAME?.trim() || hostname(),
      port: Number(process.env.SMTP_DIRECT_PORT || 25),
      requireTls: process.env.SMTP_DIRECT_REQUIRE_TLS !== "false",
    });
  } else if (mode === "console") {
    provider = new ConsoleProvider();
  } else if (host) {
    provider = new SMTPProvider({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER?.trim() || undefined,
      password: process.env.SMTP_PASSWORD || undefined,
      from: process.env.SMTP_FROM || "NyxMail <no-reply@localhost>",
    });
  } else {
    provider = new ConsoleProvider();
  }
  return provider;
}

export function resetTransportProviderForTests(): void {
  provider = null;
}

export async function sendOutbound(
  userId: string | null,
  message: OutboundMessage,
): Promise<TransportResult> {
  const mailer = getTransportProvider();
  try {
    const result = await mailer.send(message);
    await prisma.transportLog.create({
      data: {
        userId,
        provider: result.provider,
        toAddresses: [...message.to, ...message.cc, ...message.bcc].map((a) => ({
          email: normalizeEmail(a.email),
          name: a.name,
        })),
        subject: null,
        messageId: result.id,
        status: "SENT",
        preview: result.preview ?? null,
      },
    });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown transport failure";
    await prisma.transportLog.create({
      data: {
        userId,
        provider: mailer.name,
        toAddresses: [...message.to, ...message.cc, ...message.bcc].map((a) => ({
          email: normalizeEmail(a.email),
          name: a.name,
        })),
        subject: null,
        status: "FAILED",
        error: detail,
      },
    });
    throw new Error(`Mail transport failed: ${detail}`);
  }
}
