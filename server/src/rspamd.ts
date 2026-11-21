import type { SpamAction, SpamCheckResult, SpamSymbolHit } from "@nyxmail/shared";

/**
 * Small HTTP client for a local Rspamd instance.
 *
 * Rspamd is intentionally optional: when RSPAMD_URL is empty the built-in
 * heuristics in spam.ts remain the only engine. When it is configured, every
 * inbound message is scanned as raw MIME (so HTML, URLs, attachments, inline
 * images and their fuzzy hashes are all visible to Rspamd), and user reports
 * are fed back through the controller's Bayes endpoints.
 */

export interface RspamdConfig {
  enabled: boolean;
  checkUrl: string;
  controllerUrl: string;
  checkPassword: string | null;
  controllerPassword: string | null;
  timeoutMs: number;
  maxBytes: number;
  spamThreshold: number;
}

export interface RspamdScanContext {
  raw: Buffer;
  from?: string | null;
  rcpt?: string[];
  ip?: string | null;
  helo?: string | null;
  hostname?: string | null;
  user?: string | null;
  queueId?: string | null;
}

export interface RspamdScanResult {
  score: number;
  requiredScore: number | null;
  action: SpamAction;
  isSkipped: boolean;
  symbols: SpamSymbolHit[];
  urls: string[];
  emails: string[];
  messageId: string | null;
  raw: Record<string, unknown>;
}

export interface RspamdLearnContext {
  raw: Buffer;
  spam: boolean;
  from?: string | null;
  rcpt?: string[];
  ip?: string | null;
  helo?: string | null;
  user?: string | null;
}

export interface RspamdLearnResult {
  learned: boolean;
  skipped?: string;
  error?: string;
  response?: unknown;
}

export interface RspamdStatus {
  enabled: boolean;
  checkUrl: string | null;
  controllerUrl: string | null;
  checkReachable: boolean;
  controllerReachable: boolean;
  error?: string;
}

function trimBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function endpoint(base: string, path: string): string {
  if (base.endsWith(path)) return base;
  if (/\/checkv2$/i.test(base)) return base.replace(/\/checkv2$/i, path);
  return `${base}${path}`;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function rspamdConfig(): RspamdConfig {
  const configuredUrl = trimBase(process.env.RSPAMD_URL || "");
  const enabled = Boolean(configuredUrl);
  const fallbackController = (() => {
    if (!configuredUrl) return "";
    try {
      const url = new URL(configuredUrl);
      url.port = process.env.RSPAMD_CONTROLLER_PORT || "11334";
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return trimBase(url.toString());
    } catch {
      return "";
    }
  })();
  return {
    enabled,
    checkUrl: configuredUrl ? endpoint(configuredUrl, "/checkv2") : "",
    controllerUrl: process.env.RSPAMD_CONTROLLER_URL
      ? trimBase(process.env.RSPAMD_CONTROLLER_URL)
      : fallbackController,
    checkPassword: process.env.RSPAMD_CHECK_PASSWORD?.trim() || null,
    controllerPassword: process.env.RSPAMD_PASSWORD?.trim() || null,
    timeoutMs: integer(process.env.RSPAMD_TIMEOUT_MS, 8_000),
    maxBytes: integer(process.env.RSPAMD_MAX_BYTES, 25 * 1024 * 1024),
    spamThreshold: Number.isFinite(Number(process.env.RSPAMD_SPAM_SCORE))
      ? Number(process.env.RSPAMD_SPAM_SCORE)
      : 6,
  };
}

export function rspamdEnabled(): boolean {
  return rspamdConfig().enabled;
}

function requestHeaders(context: RspamdScanContext, password: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "User-Agent": "NyxMail Rspamd Client/1.0",
    Flags: "groups",
  });
  if (password) headers.set("Password", password);
  if (context.from) headers.set("From", context.from);
  for (const rcpt of context.rcpt ?? []) {
    if (rcpt) headers.append("Rcpt", rcpt);
  }
  if (context.ip) headers.set("IP", context.ip);
  if (context.helo) headers.set("Helo", context.helo);
  if (context.hostname) headers.set("Hostname", context.hostname);
  if (context.user) headers.set("User", context.user);
  if (context.queueId) headers.set("Queue-Id", context.queueId);
  if (context.rcpt?.[0]) headers.set("Deliver-To", context.rcpt[0]);
  return headers;
}

function symbolList(value: unknown): SpamSymbolHit[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const symbols: SpamSymbolHit[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const score = Number(item.score);
    const name = typeof item.name === "string" && item.name ? item.name : key;
    if (!Number.isFinite(score)) continue;
    symbols.push({
      name,
      score,
      options: Array.isArray(item.options)
        ? item.options.filter((option): option is string => typeof option === "string").slice(0, 12)
        : undefined,
      group: typeof item.group === "string" ? item.group : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
    });
  }
  return symbols.sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 200);
}

function normalizeAction(value: unknown): SpamAction {
  return typeof value === "string" && value ? value : "no action";
}

export async function scanWithRspamd(context: RspamdScanContext): Promise<RspamdScanResult | null> {
  const config = rspamdConfig();
  if (!config.enabled || !config.checkUrl || context.raw.length === 0) return null;
  if (context.raw.length > config.maxBytes) return null;

  let response: Response;
  try {
    response = await fetch(config.checkUrl, {
      method: "POST",
      headers: requestHeaders(context, config.checkPassword),
      body: new Uint8Array(context.raw),
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      `Rspamd check failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Rspamd check failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Rspamd returned an invalid JSON response");
  }
  const score = Number(parsed.score);
  const required = Number(parsed.required_score);
  return {
    score: Number.isFinite(score) ? score : 0,
    requiredScore: Number.isFinite(required) ? required : null,
    action: normalizeAction(parsed.action),
    isSkipped: parsed.is_skipped === true,
    symbols: symbolList(parsed.symbols),
    urls: stringList(parsed.urls),
    emails: stringList(parsed.emails),
    messageId: typeof parsed["message-id"] === "string" ? parsed["message-id"] : null,
    raw: parsed,
  };
}

export function rspamdActionIsSpam(action: SpamAction, score: number, threshold: number): boolean {
  if (action === "reject" || action === "add header" || action === "rewrite subject") {
    return true;
  }
  if (action === "soft reject") return score >= threshold;
  return score >= threshold;
}

export function rspamdReasons(result: RspamdScanResult): string[] {
  const reasons: string[] = [];
  const positive = result.symbols.filter((symbol) => symbol.score > 0).slice(0, 6);
  for (const symbol of positive) {
    reasons.push(`rspamd ${symbol.name} (+${symbol.score.toFixed(2)})`);
  }
  if (reasons.length === 0 && result.action !== "no action") {
    reasons.push(`rspamd action: ${result.action}`);
  }
  if (result.urls.length > 0) {
    reasons.push(`rspamd urls: ${result.urls.slice(0, 5).join(", ")}`);
  }
  return reasons;
}

export function scanToSpamResult(result: RspamdScanResult): SpamCheckResult {
  const config = rspamdConfig();
  return {
    spam: rspamdActionIsSpam(result.action, result.score, config.spamThreshold),
    score: Math.round(result.score * 100) / 100,
    reasons: rspamdReasons(result),
    engine: "rspamd",
    action: result.action,
    requiredScore: result.requiredScore ?? undefined,
    symbols: result.symbols.slice(0, 80),
  };
}

function learnHeaders(context: RspamdLearnContext, password: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "User-Agent": "NyxMail Rspamd Learner/1.0",
  });
  if (password) headers.set("Password", password);
  if (context.from) headers.set("From", context.from);
  for (const rcpt of context.rcpt ?? []) {
    if (rcpt) headers.append("Rcpt", rcpt);
  }
  if (context.ip) headers.set("IP", context.ip);
  if (context.helo) headers.set("Helo", context.helo);
  if (context.user) headers.set("User", context.user);
  if (context.rcpt?.[0]) headers.set("Deliver-To", context.rcpt[0]);
  return headers;
}

/**
 * Teach the Bayes classifier. /learnspam and /learnham live on the controller
 * worker (11334 by default), not the normal scanner worker.
 */
export async function learnWithRspamd(context: RspamdLearnContext): Promise<RspamdLearnResult> {
  const config = rspamdConfig();
  if (!config.enabled) return { learned: false, skipped: "rspamd is not configured" };
  if (!config.controllerUrl) return { learned: false, skipped: "rspamd controller is not configured" };
  if (context.raw.length === 0) return { learned: false, skipped: "no training sample supplied" };
  if (context.raw.length > config.maxBytes) return { learned: false, skipped: "training sample is too large" };

  const direction = context.spam ? "spam" : "ham";
  const url = endpoint(config.controllerUrl, context.spam ? "/learnspam" : "/learnham");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: learnHeaders(context, config.controllerPassword),
      body: new Uint8Array(context.raw),
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    return {
      learned: false,
      error: `rspamd ${direction} learning failed: ${
        error instanceof Error ? error.message : "network error"
      }`,
    };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    // Rspamd returns 404 when the same Message-ID was already learned. That is
    // not a failure: the classifier already has this sample.
    if (response.status === 404 && /already learned/i.test(text)) {
      return { learned: true, skipped: "sample was already learned", response: text };
    }
    return {
      learned: false,
      error: `rspamd ${direction} learning failed: HTTP ${response.status}${
        text ? ` (${text.slice(0, 200)})` : ""
      }`,
    };
  }
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      // Rspamd sometimes replies with a plain string.
    }
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  if (record && (record.success === false || typeof record.error === "string")) {
    return {
      learned: false,
      error:
        typeof record.error === "string"
          ? record.error
          : `rspamd ${direction} learning was rejected`,
      response: parsed,
    };
  }
  return { learned: true, response: parsed };
}

export async function rspamdStatus(): Promise<RspamdStatus> {
  const config = rspamdConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      checkUrl: null,
      controllerUrl: null,
      checkReachable: false,
      controllerReachable: false,
    };
  }
  const ping = async (url: string, password: string | null) => {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: password ? { Password: password } : undefined,
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 2_500)),
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  const [checkReachable, controllerReachable] = await Promise.all([
    ping(endpoint(config.checkUrl, "/ping"), config.checkPassword),
    config.controllerUrl
      ? ping(endpoint(config.controllerUrl, "/ping"), config.controllerPassword)
      : Promise.resolve(false),
  ]);
  return {
    enabled: true,
    checkUrl: config.checkUrl,
    controllerUrl: config.controllerUrl || null,
    checkReachable,
    controllerReachable,
  };
}
