import { promises as dns } from "node:dns";
import type { FilterKind, SpamCheckResult, SpamSymbolHit } from "@nyxmail/shared";
import { domainOf, normalizeEmail } from "@nyxmail/shared";
import {
  rspamdConfig,
  scanToSpamResult,
  scanWithRspamd,
  type RspamdScanResult,
} from "./rspamd";

export interface SpamFilter {
  kind: FilterKind;
  pattern: string;
}

export interface SpamContext {
  fromAddress: string;
  fromName?: string | null;
  subject: string;
  text: string;
  html?: string;
  /** Raw MIME is what Rspamd needs to inspect HTML, URLs and images. */
  raw?: Buffer;
  toAddresses?: string[];
  recipient?: string | null;
  replyTo?: string | null;
  spf?: string | null;
  dkim?: string | null;
  dmarc?: string | null;
  senderIp?: string | null;
  helo?: string | null;
  userId?: string | null;
  filters: SpamFilter[];
  senderSpamReports?: number;
  senderHamReports?: number;
  knownSender?: boolean;
  rblZone?: string | null;
}

const LOCAL_SPAM_THRESHOLD = 5;

const SPAM_TERMS = [
  "viagra",
  "cialis",
  "lottery winner",
  "claim your prize",
  "wire transfer",
  "seed phrase",
  "recovery phrase",
  "crypto giveaway",
  "bitcoin doubler",
  "act now",
  "risk-free",
  "pre-approved",
  "final notice",
  "unclaimed funds",
  "work from home",
  "100% free",
  "limited time offer",
  "nigerian prince",
  "guaranteed income",
  "make money fast",
  "no credit check",
  "miracle cure",
  "weight loss miracle",
  "exclusive investment opportunity",
  "your account will be suspended",
  "verify your account immediately",
  "urgent action required",
  "click the link below to verify",
  "you have won",
  "free gift card",
];

const SPAM_PATTERNS: Array<{ pattern: RegExp; points: number; reason: string }> = [
  {
    pattern: /\b(?:bitcoin|btc|ethereum|eth|usdt|crypto|wallet)\b[\s\S]{0,80}\b(?:giveaway|doubler|airdrop|investment|profit|return)\b/i,
    points: 3,
    reason: "crypto/investment bait",
  },
  {
    pattern: /\b(?:seed|recovery|private key|mnemonic) phrase\b/i,
    points: 4,
    reason: "asks for a wallet recovery phrase",
  },
  {
    pattern: /\b(?:gift card|itunes card|steam card|google play card)\b[\s\S]{0,80}\b(?:code|scratch|send|buy)\b/i,
    points: 2.5,
    reason: "gift-card scam pattern",
  },
  {
    pattern: /\b(?:your|the) (?:account|mailbox|subscription) (?:has been|will be|is) (?:suspended|locked|closed|deactivated)\b/i,
    points: 2,
    reason: "account-suspension pressure",
  },
  {
    pattern: /\b(?:dear|hello) (?:customer|account holder|user|friend)\b/i,
    points: 0.75,
    reason: "generic greeting",
  },
  {
    pattern: /\b(?:urgent|immediately|within 24 hours|final warning|last chance)\b[\s\S]{0,120}\b(?:click|verify|pay|confirm|update)\b/i,
    points: 1.5,
    reason: "urgency plus call to action",
  },
];

const SHORTENER_HOSTS =
  /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rebrand\.ly|shorturl\.at|rb\.gy)$/i;

const SUSPICIOUS_TLDS =
  /\.(?:zip|mov|xyz|top|click|work|loan|win|gq|tk|ml|cf|cam|rest|buzz|cyou|sbs)$/i;

const DANGEROUS_ATTACHMENTS =
  /\.(?:exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|wsf|wsh|hta|jar|msi|ps1|lnk|iso|img|dmg|apk|html?|svg)(?:\.|$)/i;

export function patternMatches(pattern: string, address: string): boolean {
  const p = pattern.trim().toLowerCase();
  const a = normalizeEmail(address);
  if (!p || !a) return false;
  if (p.startsWith("@")) return domainOf(a) === p.slice(1);
  if (p.includes("@")) {
    if (a === p) return true;
    const candidateDomain = p.split("@")[1];
    return Boolean(candidateDomain) && domainOf(a) === candidateDomain;
  }
  return domainOf(a) === p || a.split("@")[0] === p;
}

async function checkRbl(ip: string, zone: string): Promise<boolean> {
  if (!zone || !ip || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return false;
  const reversed = ip.split(".").reverse().join(".");
  try {
    const result = await Promise.race([
      dns.resolve4(`${reversed}.${zone}`),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ]);
    return Array.isArray(result) && result.length > 0;
  } catch {
    return false;
  }
}

function urlsIn(text: string, html = ""): URL[] {
  const found = new Set<string>();
  const re = /\bhttps?:\/\/[^\s"'<>]+/gi;
  for (const match of `${text}\n${html}`.matchAll(re)) {
    const value = match[0].replace(/[),.;!?]+$/g, "");
    try {
      found.add(new URL(value).toString());
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(found)
    .slice(0, 200)
    .map((value) => new URL(value));
}

function senderPenalty(reports = 0): number {
  return reports > 0 ? Math.min(4, reports * 0.75) : 0;
}

function localScore(context: SpamContext): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  const spfFail = context.spf === "fail" || context.spf === "softfail";
  const dkimFail = context.dkim === "fail";
  const dmarcFail = context.dmarc === "fail";
  if (context.spf && context.spf !== "pass" && context.spf !== "none") {
    add(spfFail ? 2.5 : 1, `SPF ${context.spf}`);
  }
  if (dkimFail) add(1.5, "DKIM failed");
  if (dmarcFail) add(3, "DMARC failed");
  if (spfFail && dkimFail && dmarcFail) add(2, "SPF, DKIM and DMARC all failed");

  const haystack = `${context.subject}\n${context.text.slice(0, 30_000)}\n${
    context.html?.slice(0, 30_000) ?? ""
  }`.toLowerCase();
  const hits = SPAM_TERMS.filter((term) => haystack.includes(term));
  if (hits.length > 0) {
    add(Math.min(4, hits.length * 1.25), `spam phrases: ${hits.slice(0, 3).join(", ")}`);
  }
  for (const rule of SPAM_PATTERNS) {
    if (rule.pattern.test(haystack)) add(rule.points, rule.reason);
  }
  if (/\b(congratulations|winner|prize)\b/i.test(context.subject) && /!{2,}/.test(context.subject)) {
    add(1.5, "classic prize-bait subject");
  }

  const urls = urlsIn(context.text, context.html);
  if (urls.length >= 8) add(1, `many links (${urls.length})`);
  if (urls.some((url) => SHORTENER_HOSTS.test(url.hostname))) add(1, "URL shortener");
  if (urls.some((url) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname))) {
    add(2.5, "link uses a bare IP address");
  }
  if (urls.some((url) => SUSPICIOUS_TLDS.test(url.hostname))) add(1.25, "link uses a high-risk TLD");

  if (
    context.fromName &&
    /@/.test(context.fromName) &&
    !context.fromName.toLowerCase().includes(normalizeEmail(context.fromAddress))
  ) {
    add(2, "display name contains a different email address");
  }
  if (context.replyTo) {
    const replyDomain = domainOf(context.replyTo);
    const fromDomain = domainOf(context.fromAddress);
    if (replyDomain && fromDomain && replyDomain !== fromDomain) {
      add(1.5, `Reply-To domain differs from sender (${replyDomain})`);
    }
  }

  return { score, reasons };
}

function spamResult(
  spam: boolean,
  score: number,
  reasons: string[],
  extras: Partial<SpamCheckResult> = {},
): SpamCheckResult {
  return {
    spam,
    score: Math.round(score * 100) / 100,
    reasons,
    ...extras,
  };
}

export async function evaluateSpam(context: SpamContext): Promise<SpamCheckResult> {
  const filters = context.filters.map((f) => ({ ...f, pattern: f.pattern.toLowerCase() }));
  const allow = filters.some(
    (f) => f.kind === "ALLOW" && patternMatches(f.pattern, context.fromAddress),
  );
  if (allow) {
    return spamResult(false, 0, ["sender on allowlist"], {
      engine: "filter",
      symbols: [],
    });
  }

  const block = filters.some(
    (f) => f.kind === "BLOCK" && patternMatches(f.pattern, context.fromAddress),
  );
  if (block) {
    return spamResult(true, 100, ["sender on blocklist"], {
      engine: "filter",
      symbols: [],
    });
  }

  let rspamd: RspamdScanResult | null = null;
  let rspamdError: string | null = null;
  if (context.raw && context.raw.length > 0) {
    try {
      rspamd = await scanWithRspamd({
        raw: context.raw,
        from: context.fromAddress,
        rcpt: context.recipient
          ? [context.recipient]
          : context.toAddresses?.slice(0, 20),
        ip: context.senderIp,
        helo: context.helo,
        user: context.userId,
      });
    } catch (error) {
      rspamdError = error instanceof Error ? error.message : "rspamd scan failed";
    }
  }

  const local = localScore(context);
  const reportsPenalty = senderPenalty(context.senderSpamReports ?? 0);
  if (rspamd) {
    const base = scanToSpamResult(rspamd);
    // Rspamd can miss plain-text scams when a test/synthetic message has no
    // Received chain (and therefore no SPF/DKIM context). Keep the stronger of
    // the two content scores instead of throwing away the local signals.
    let score = Math.max(base.score, local.score) + reportsPenalty;
    if ((context.senderHamReports ?? 0) > 0 && !(context.senderSpamReports ?? 0)) {
      score = Math.max(0, score - Math.min(2, (context.senderHamReports ?? 0) * 0.35));
    }
    if (context.knownSender && !base.spam && !(context.senderSpamReports ?? 0)) {
      score = Math.max(0, score - 0.5);
    }
    const reasons = [...base.reasons];
    if (local.score > base.score) {
      reasons.push(
        `built-in heuristics scored ${local.score.toFixed(2)}${
          local.reasons.length ? `: ${local.reasons.slice(0, 3).join(", ")}` : ""
        }`,
      );
    } else {
      reasons.push(...local.reasons.filter((reason) => /phrase|scam|bait|attachment|link|Reply-To/i.test(reason)).slice(0, 3));
    }
    if (reportsPenalty > 0) reasons.unshift("sender reported as spam before");
    if ((context.senderHamReports ?? 0) > 0 && !(context.senderSpamReports ?? 0)) {
      reasons.push("sender marked not spam before");
    }
    const spam = base.spam || score >= LOCAL_SPAM_THRESHOLD;
    return spamResult(spam, score, reasons, {
      engine: "rspamd",
      action: base.action,
      requiredScore: base.requiredScore,
      symbols: base.symbols,
    });
  }

  if (context.rblZone && context.senderIp) {
    const listed = await checkRbl(context.senderIp, context.rblZone);
    if (listed) {
      local.score += 5;
      local.reasons.push("sender IP on DNSBL");
    }
  }
  let score = local.score + reportsPenalty;
  if (reportsPenalty > 0) local.reasons.unshift("sender reported as spam before");
  if ((context.senderHamReports ?? 0) > 0 && !(context.senderSpamReports ?? 0)) {
    score = Math.max(0, score - Math.min(2, (context.senderHamReports ?? 0) * 0.35));
    local.reasons.push("sender marked not spam before");
  }
  if (
    context.knownSender &&
    context.spf !== "fail" &&
    context.dmarc !== "fail" &&
    !(context.senderSpamReports ?? 0)
  ) {
    score = Math.max(0, score - 0.75);
  }
  if (rspamdError && process.env.NODE_ENV !== "test") {
    local.reasons.push(`rspamd unavailable: ${rspamdError}`);
  }
  local.reasons.push("built-in local heuristics");
  const symbols: SpamSymbolHit[] = [];
  return spamResult(score >= LOCAL_SPAM_THRESHOLD, score, local.reasons, {
    engine: "local",
    symbols,
  });
}
