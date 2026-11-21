import { domainOf, isEmail, normalizeEmail } from "./utils";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isValidDomain(value: string): boolean {
  return Boolean(value) && DOMAIN_RE.test(normalizeDomain(value));
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map(normalizeDomain)
    .filter((domain) => domain && isValidDomain(domain));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function primaryMailDomain(): string {
  const primary = normalizeDomain(process.env.MAIL_DOMAIN || "");
  if (primary && isValidDomain(primary)) return primary;
  const firstConfigured = envList("MAIL_DOMAINS")[0];
  return firstConfigured || "localhost";
}

/**
 * Domains accepted for inbound mail and aliases.
 *
 * `MAIL_DOMAIN` remains the primary identity (Message-ID generation, defaults).
 * Additional domains come from `MAIL_DOMAINS` and any key in `CATCH_ALL_MAP`.
 */
export function mailDomains(): string[] {
  const catchAllDomains = Object.keys(catchAllMap());
  return unique([
    primaryMailDomain(),
    ...envList("MAIL_DOMAINS"),
    ...catchAllDomains,
  ]);
}

/**
 * Domains that may be claimed during public signup. Defaults to the primary
 * domain only so adding a catch-all domain does not silently open signup on it.
 */
export function signupDomains(): string[] {
  const configured = envList("SIGNUP_DOMAINS");
  const available = mailDomains();
  if (configured.length > 0) {
    const filtered = configured.filter((domain) => available.includes(domain));
    if (filtered.length > 0) return unique(filtered);
  }
  return [primaryMailDomain()];
}

export function isMailDomain(domain: string): boolean {
  return mailDomains().includes(normalizeDomain(domain));
}

export function isSignupDomain(domain: string): boolean {
  return signupDomains().includes(normalizeDomain(domain));
}

/**
 * Parse the catch-all configuration.
 *
 * Preferred:
 *   CATCH_ALL_MAP='{"example.net":"you@example.net"}'
 *
 * Also accepted:
 *   CATCH_ALL_MAP="example.net=you@example.net,other.dev=you@example.com"
 *
 * Single-domain shorthand:
 *   CATCH_ALL_DOMAIN=example.net
 *   CATCH_ALL_ADDRESS=you@example.net
 */
export function catchAllMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const raw = process.env.CATCH_ALL_MAP?.trim();

  if (raw) {
    let parsed: Record<string, unknown> | null = null;
    if (raw.startsWith("{")) {
      try {
        const candidate: unknown = JSON.parse(raw);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          parsed = candidate as Record<string, unknown>;
        }
      } catch {
        parsed = null;
      }
    } else {
      parsed = {};
      for (const item of raw.split(/[,\n;]+/)) {
        const separator = item.indexOf("=");
        if (separator === -1) continue;
        parsed[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
      }
    }
    if (parsed) {
      for (const [domainRaw, targetRaw] of Object.entries(parsed)) {
        const domain = normalizeDomain(domainRaw);
        const target = typeof targetRaw === "string" ? normalizeEmail(targetRaw) : "";
        if (isValidDomain(domain) && isEmail(target)) map[domain] = target;
      }
    }
  }

  const singleDomain = normalizeDomain(process.env.CATCH_ALL_DOMAIN || "");
  const singleTarget = normalizeEmail(process.env.CATCH_ALL_ADDRESS || "");
  if (singleDomain && singleTarget && isValidDomain(singleDomain) && isEmail(singleTarget)) {
    map[singleDomain] = singleTarget;
  }
  return map;
}

export function catchAllTargetFor(domain: string): string | null {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  return catchAllMap()[normalized] ?? null;
}

export function catchAllTargetForAddress(address: string): string | null {
  return catchAllTargetFor(domainOf(address));
}
