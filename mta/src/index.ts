import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(root, ".env") });

function log(message: string): void {
  console.log(`[nyxmail:mta ${new Date().toISOString()}] ${message}`);
}

function smtpError(message: string, responseCode = 451): Error & { responseCode: number } {
  const error = new Error(message) as Error & { responseCode: number };
  error.responseCode = responseCode;
  return error;
}

async function main(): Promise<void> {
  const [{ SMTPServer }, { authenticate }, serverModule] = await Promise.all([
    import("smtp-server"),
    import("mailauth"),
    import("@nyxmail/server"),
  ]);
  const { findLocalRecipient, ingestRawMessage, isHostedDomain } = serverModule;

  const host = process.env.SMTP_INBOUND_HOST?.trim() || "0.0.0.0";
  const port = Number(process.env.SMTP_INBOUND_PORT || 2525);
  const hostname = process.env.MAIL_HOSTNAME?.trim() || "mail.localhost";
  const maxBytes = Number(process.env.SMTP_INBOUND_MAX_BYTES || 60 * 1024 * 1024);

  let tls: { key: Buffer; cert: Buffer } | undefined;
  const keyPath = process.env.SMTP_TLS_KEY_PATH?.trim();
  const certPath = process.env.SMTP_TLS_CERT_PATH?.trim();
  if (keyPath && certPath) {
    try {
      tls = {
        key: await readFile(resolve(keyPath)),
        cert: await readFile(resolve(certPath)),
      };
    } catch (error) {
      log(`could not load SMTP TLS certificate: ${(error as Error).message}`);
    }
  }

  type AuthResults = { spf?: string; dkim?: string; dmarc?: string };

  function normalizeSpf(value: string | undefined): AuthResults["spf"] {
    return value === "pass" || value === "fail" || value === "softfail" || value === "neutral"
      ? value
      : "none";
  }

  function normalizeDkim(value: string | undefined): AuthResults["dkim"] {
    return value === "pass" ? "pass" : value === "fail" ? "fail" : "none";
  }

  function normalizeDmarc(value: string | undefined): AuthResults["dmarc"] {
    return value === "pass" ? "pass" : value === "fail" ? "fail" : "none";
  }

  async function authenticateMessage(
    raw: Buffer,
    remoteAddress: string | undefined,
    helo: string | undefined,
    sender: string | undefined,
  ): Promise<AuthResults | undefined> {
    if (!remoteAddress) return undefined;
    try {
      const result = await authenticate(raw, {
        ip: remoteAddress,
        helo,
        sender,
        mta: hostname,
        disableArc: true,
        disableBimi: true,
      });
      const dkimResults = result.dkim?.results ?? [];
      const dkimResult = dkimResults.some((item) => item.status.result === "pass")
        ? "pass"
        : dkimResults.length > 0
          ? "fail"
          : "none";
      return {
        spf: normalizeSpf(result.spf ? result.spf.status.result : undefined),
        dkim: normalizeDkim(dkimResult),
        dmarc: normalizeDmarc(result.dmarc ? result.dmarc.status.result : undefined),
      };
    } catch (error) {
      log(`authentication check failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  const server = new SMTPServer({
    name: hostname,
    banner: `NyxMail ESMTP ${hostname}`,
    size: maxBytes,
    authOptional: true,
    disabledCommands: ["AUTH"],
    hideSTARTTLS: !tls,
    ...(tls ?? {}),
    logger: {
      info: (entry: unknown) => log(typeof entry === "string" ? entry : JSON.stringify(entry)),
      debug: () => undefined,
      warn: (entry: unknown) => log(typeof entry === "string" ? entry : JSON.stringify(entry)),
      error: (entry: unknown) => log(typeof entry === "string" ? entry : JSON.stringify(entry)),
    },
    onRcptTo(address, _session, callback) {
      const recipient = address.address.toLowerCase();
      const domain = recipient.split("@").pop() || "";
      void (async () => {
        if (!(await isHostedDomain(domain))) {
          callback(smtpError("Relay access denied", 550));
          return;
        }
        const local = await findLocalRecipient(recipient);
        if (!local) {
          callback(smtpError("No such mailbox", 550));
          return;
        }
        callback();
      })().catch((error) => {
        log(`recipient lookup failed: ${(error as Error).message}`);
        callback(smtpError("Mailbox temporarily unavailable"));
      });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      let total = 0;
      let finished = false;

      const finish = (error?: Error & { responseCode?: number }, message?: string) => {
        if (finished) return;
        finished = true;
        callback(error ?? null, message);
      };

      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          finish(smtpError("Message too large", 552));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", (error) => {
        finish(smtpError(`Could not read message: ${error.message}`));
      });
      stream.on("end", () => {
        if (finished) return;
        const received =
          `Received: from ${session.clientHostname || "unknown"} ([${session.remoteAddress || "unknown"}])\n` +
          `\tby ${hostname} with ESMTP id ${randomUUID()};\n` +
          `\t${new Date().toUTCString()}\n`;
        const raw = Buffer.concat(chunks);
        const recipients = session.envelope.rcptTo.map((item) => item.address);
        const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined;
        const remoteAddress =
          typeof session.remoteAddress === "string" ? session.remoteAddress : undefined;
        const helo = session.clientHostname || undefined;

        void (async () => {
          const authResults = await authenticateMessage(raw, remoteAddress, helo, sender);
          try {
            const result = await ingestRawMessage({
              envelopeFrom: sender,
              envelopeTo: recipients,
              raw: Buffer.concat([Buffer.from(received, "utf8"), raw]),
              authResults,
            });
            if (result.errors.length > 0) {
              log(`ingest errors for ${recipients.join(", ")}: ${result.errors.join("; ")}`);
              finish(smtpError("Message could not be stored; retry later"));
              return;
            }
            if (result.delivered.length === 0 && result.duplicates === 0) {
              log(`no local delivery for ${recipients.join(", ")}: ${JSON.stringify(result.skipped)}`);
              finish(smtpError("No such mailbox", 550));
              return;
            }
            log(
              `accepted ${raw.length} bytes from ${sender || "unknown"} for ${recipients.join(", ")} ` +
                `(spf=${authResults?.spf ?? "none"} dkim=${authResults?.dkim ?? "none"} dmarc=${authResults?.dmarc ?? "none"}` +
                `${result.duplicates > 0 ? `, ${result.duplicates} duplicate` : ""})`,
            );
            finish(undefined, "Message accepted for delivery");
          } catch (error) {
            log(`ingest failed: ${(error as Error).message}`);
            finish(smtpError("Message could not be stored; retry later"));
          }
        })();
      });
    },
  });

  server.on("error", (error) => {
    log(`server error: ${error.message}`);
  });

  server.listen(port, host, () => {
    log(`listening on ${host}:${port} as ${hostname}`);
    log(
      tls
        ? "STARTTLS enabled"
        : "STARTTLS disabled: set SMTP_TLS_KEY_PATH and SMTP_TLS_CERT_PATH to enable it",
    );
  });

  const shutdown = () => {
    log("shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  log(`fatal: ${(error as Error).message}`);
  process.exit(1);
});
