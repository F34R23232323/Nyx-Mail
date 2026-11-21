import { generateKeyPairSync } from "node:crypto";
import { prisma } from "@nyxmail/db";
import { domainOf, normalizeEmail } from "@nyxmail/shared";
import {
  catchAllMap,
  catchAllTargetForAddress,
  isValidDomain,
  mailDomains,
  normalizeDomain,
  primaryMailDomain,
  signupDomains,
} from "@nyxmail/shared/domains";
import { decryptSecret, encryptSecret } from "@nyxmail/shared/secrets";

export interface HostedDomainConfig {
  domain: string;
  isPrimary: boolean;
  allowSignup: boolean;
  catchAllAddress: string | null;
  dkimSelector: string | null;
  dkimPublicKey: string | null;
  /** The domain is still listed in MAIL_DOMAINS or CATCH_ALL_MAP. */
  fromEnvironment: boolean;
  /** A MailDomain row exists and can be edited in the UI. */
  managed: boolean;
}

export interface DomainSettings {
  primary: string;
  domains: HostedDomainConfig[];
  signupDomains: string[];
  catchAll: Record<string, string>;
  dkimPublicKeys: Record<string, string>;
}

export function defaultDkimSelector(): string {
  return (process.env.DKIM_SELECTOR || "nyxmail").trim().replace(/\.$/, "");
}

/**
 * Public DKIM keys configured through the environment. New domains store
 * their key in the database instead, but this keeps existing installations
 * working without a migration.
 */
export function envDkimPublicKeys(): Record<string, string> {
  const raw = process.env.DKIM_PUBLIC_KEY_MAP?.trim();
  const map: Record<string, string> = {};
  const fallback = process.env.DKIM_PUBLIC_KEY?.trim();
  if (fallback) {
    map[primaryMailDomain()] = fallback.replace(/\s+/g, "");
  }
  if (!raw) return map;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [domain, value] of Object.entries(parsed)) {
      if (typeof value !== "string") continue;
      const cleaned = value.replace(/\s+/g, "");
      if (cleaned) map[normalizeDomain(domain)] = cleaned;
    }
  } catch {
    // Invalid admin config should not break the settings page.
  }
  return map;
}

/** Synchronous environment-only view. Used by tests and as the fallback. */
export function environmentDomainSettings(): DomainSettings {
  const primary = primaryMailDomain();
  const signup = signupDomains();
  const catchAll = catchAllMap();
  const keys = envDkimPublicKeys();
  const selector = defaultDkimSelector();
  const domains = mailDomains().map((domain) => ({
    domain,
    isPrimary: domain === primary,
    allowSignup: signup.includes(domain),
    catchAllAddress: catchAll[domain] ?? null,
    dkimSelector: selector,
    dkimPublicKey: keys[domain] ?? null,
    fromEnvironment: true,
    managed: false,
  }));

  return {
    primary,
    domains,
    signupDomains: domains.filter((domain) => domain.allowSignup).map((domain) => domain.domain),
    catchAll: Object.fromEntries(
      domains
        .filter((domain) => domain.catchAllAddress)
        .map((domain) => [domain.domain, domain.catchAllAddress!]),
    ),
    dkimPublicKeys: keys,
  };
}

/**
 * Merge environment bootstrap settings with runtime-managed domains. A
 * database row can override signup/catch-all/DKIM settings for an environment
 * domain, but it never removes the environment domain itself.
 */
export async function loadDomainSettings(): Promise<DomainSettings> {
  const env = environmentDomainSettings();
  const rows = await prisma.mailDomain.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
    select: {
      domain: true,
      allowSignup: true,
      catchAllAddress: true,
      dkimSelector: true,
      dkimPublicKey: true,
    },
  });

  const byDomain = new Map(env.domains.map((domain) => [domain.domain, { ...domain }]));
  for (const row of rows) {
    const domain = normalizeDomain(row.domain);
    if (!isValidDomain(domain)) continue;
    const existing = byDomain.get(domain);
    byDomain.set(domain, {
      domain,
      isPrimary: domain === env.primary,
      allowSignup: Boolean(existing?.allowSignup || row.allowSignup),
      catchAllAddress: row.catchAllAddress ?? existing?.catchAllAddress ?? null,
      dkimSelector: row.dkimSelector ?? existing?.dkimSelector ?? defaultDkimSelector(),
      dkimPublicKey: row.dkimPublicKey ?? existing?.dkimPublicKey ?? null,
      fromEnvironment: existing?.fromEnvironment ?? false,
      managed: true,
    });
  }

  const domains = Array.from(byDomain.values()).sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    return 0;
  });

  return {
    primary: env.primary,
    domains,
    signupDomains: domains.filter((domain) => domain.allowSignup).map((domain) => domain.domain),
    catchAll: Object.fromEntries(
      domains
        .filter((domain) => domain.catchAllAddress)
        .map((domain) => [domain.domain, domain.catchAllAddress!]),
    ),
    dkimPublicKeys: Object.fromEntries(
      domains
        .filter((domain) => domain.dkimPublicKey)
        .map((domain) => [domain.domain, domain.dkimPublicKey!]),
    ),
  };
}

export async function hostedDomains(): Promise<string[]> {
  return (await loadDomainSettings()).domains.map((domain) => domain.domain);
}

export async function signupHostedDomains(): Promise<string[]> {
  return (await loadDomainSettings()).signupDomains;
}

export async function isHostedDomain(domain: string): Promise<boolean> {
  const normalized = normalizeDomain(domain);
  if (!normalized || !isValidDomain(normalized)) return false;
  if (mailDomains().includes(normalized)) return true;
  const row = await prisma.mailDomain.findUnique({
    where: { domain: normalized },
    select: { enabled: true },
  });
  return Boolean(row?.enabled);
}

export async function catchAllHostedTargetForAddress(address: string): Promise<string | null> {
  const normalized = normalizeEmail(address);
  if (!normalized) return null;
  const row = await prisma.mailDomain.findUnique({
    where: { domain: domainOf(normalized) },
    select: { enabled: true, catchAllAddress: true },
  });
  if (row?.enabled && row.catchAllAddress) return row.catchAllAddress;
  return catchAllTargetForAddress(normalized);
}

export interface GeneratedDkimKey {
  selector: string;
  publicKey: string;
  privateKeyEncrypted: string;
}

export function createDomainDkimKey(): GeneratedDkimKey {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    selector: defaultDkimSelector(),
    publicKey: pair.publicKey.toString("base64"),
    privateKeyEncrypted: encryptSecret(pair.privateKey),
  };
}

export interface DomainDkimKey {
  privateKey: string;
  selector: string;
}

/** Decrypt a database-stored DKIM private key for outbound signing. */
export async function domainDkimKey(domain: string): Promise<DomainDkimKey | null> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const row = await prisma.mailDomain.findUnique({
    where: { domain: normalized },
    select: { dkimPrivateKey: true, dkimSelector: true, enabled: true },
  });
  if (!row?.enabled || !row.dkimPrivateKey) return null;
  try {
    return {
      privateKey: decryptSecret(row.dkimPrivateKey),
      selector: row.dkimSelector || defaultDkimSelector(),
    };
  } catch (error) {
    console.warn(
      `[nyxmail] could not decrypt DKIM key for ${normalized}: ${(error as Error).message}`,
    );
    return null;
  }
}
