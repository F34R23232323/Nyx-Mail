import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import {
  defaultDkimSelector,
  environmentDomainSettings,
  loadDomainSettings,
  type DomainSettings,
} from "./domains";

export interface DnsRecord {
  type: "MX" | "TXT" | "A" | "AAAA" | "PTR";
  name: string;
  value: string;
  ttl: number;
  purpose: string;
  configured: boolean;
  providerSide?: boolean;
}

export interface DomainDnsSetup {
  domain: string;
  isPrimary: boolean;
  isSignupDomain: boolean;
  catchAll: boolean;
  records: DnsRecord[];
  zoneFile: string;
}

export interface DnsSetup {
  hostname: string;
  dkimSelector: string;
  ipv4: string | null;
  ipv6: string | null;
  domains: DomainDnsSetup[];
  localDomains: string[];
  notes: string[];
}

export type DnsRecordCheckStatus =
  | "ok"
  | "missing"
  | "mismatch"
  | "error"
  | "not_configured";

export interface DnsRecordCheck {
  type: DnsRecord["type"];
  name: string;
  expected: string;
  actual: string[];
  status: DnsRecordCheckStatus;
  detail?: string;
}

export interface DomainDnsCheck {
  domain: string;
  status: "ok" | "warning" | "error";
  checkedAt: string;
  records: DnsRecordCheck[];
}

export interface DnsCheckResult {
  checkedAt: string;
  provider: string;
  domains: DomainDnsCheck[];
}

export interface DnsResolver {
  readonly label?: string;
  resolveMx(domain: string): Promise<Array<{ priority: number; exchange: string }>>;
  resolveTxt(name: string): Promise<string[][]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
}

const systemResolver: DnsResolver = {
  label: "System DNS",
  resolveMx: (domain) => dns.resolveMx(domain),
  resolveTxt: (name) => dns.resolveTxt(name),
  resolve4: (name) => dns.resolve4(name),
  resolve6: (name) => dns.resolve6(name),
  reverse: (ip) => dns.reverse(ip),
};

const CLOUDFLARE_DOH = "https://cloudflare-dns.com/dns-query";

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

async function queryCloudflare(name: string, type: string): Promise<DohAnswer[]> {
  const response = await fetch(
    `${CLOUDFLARE_DOH}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare DoH returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as DohResponse;
  if (body.Status === 3) return [];
  if (body.Status !== 0) {
    throw new Error(`Cloudflare DoH returned DNS status ${body.Status}`);
  }
  return body.Answer ?? [];
}

function parseTxtData(data: string): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < data.length) {
    if (data[index] !== '"') {
      index += 1;
      continue;
    }
    index += 1;
    let chunk = "";
    while (index < data.length && data[index] !== '"') {
      if (data[index] === "\\" && index + 1 < data.length) {
        chunk += data[index + 1];
        index += 2;
        continue;
      }
      chunk += data[index];
      index += 1;
    }
    if (data[index] === '"') index += 1;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks : [data];
}

function reverseName(ip: string): string | null {
  if (isIP(ip) === 4) {
    return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  }
  return null;
}

function createCloudflareResolver(): DnsResolver {
  let fallback = false;

  const system = <T>(operation: () => Promise<T>, fallbackOperation: () => Promise<T>): Promise<T> => {
    return operation().catch(() => {
      fallback = true;
      return fallbackOperation();
    });
  };

  return {
    get label() {
      return fallback ? "System DNS (Cloudflare fallback)" : "Cloudflare DNS (1.1.1.1)";
    },
    resolveMx(domain) {
      return system(
        async () => {
          const answers = await queryCloudflare(domain, "MX");
          return answers
            .filter((answer) => answer.type === 15)
            .map((answer) => {
              const [priority, ...exchangeParts] = answer.data.trim().split(/\s+/);
              return {
                priority: Number(priority),
                exchange: exchangeParts.join(" "),
              };
            })
            .filter((item) => Number.isFinite(item.priority) && item.exchange);
        },
        () => systemResolver.resolveMx(domain),
      );
    },
    resolveTxt(name) {
      return system(
        async () => {
          const answers = await queryCloudflare(name, "TXT");
          return answers
            .filter((answer) => answer.type === 16)
            .map((answer) => parseTxtData(answer.data));
        },
        () => systemResolver.resolveTxt(name),
      );
    },
    resolve4(name) {
      return system(
        async () => {
          const answers = await queryCloudflare(name, "A");
          return answers
            .filter((answer) => answer.type === 1)
            .map((answer) => answer.data.trim());
        },
        () => systemResolver.resolve4(name),
      );
    },
    resolve6(name) {
      return system(
        async () => {
          const answers = await queryCloudflare(name, "AAAA");
          return answers
            .filter((answer) => answer.type === 28)
            .map((answer) => answer.data.trim());
        },
        () => systemResolver.resolve6(name),
      );
    },
    reverse(ip) {
      const name = reverseName(ip);
      if (!name) return systemResolver.reverse(ip);
      return system(
        async () => {
          const answers = await queryCloudflare(name, "PTR");
          return answers
            .filter((answer) => answer.type === 12)
            .map((answer) => answer.data.trim());
        },
        () => systemResolver.reverse(ip),
      );
    },
  };
}

function defaultHostname(primary: string): string {
  const configured = process.env.MAIL_HOSTNAME?.trim();
  if (configured) return configured.replace(/\.$/, "").toLowerCase();
  try {
    return new URL(process.env.APP_URL || "http://localhost:3000").hostname.toLowerCase();
  } catch {
    return `mail.${primary}`;
  }
}

function isLocalOnlyDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  return (
    !normalized ||
    !normalized.includes(".") ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".invalid")
  );
}

function dkimValue(key: string): string {
  if (/^v=DKIM1/i.test(key)) return key;
  return `v=DKIM1; k=rsa; p=${key}`;
}

function zoneLine(record: DnsRecord): string {
  const value = record.type === "TXT" ? `"${record.value.replace(/"/g, '\\"')}"` : record.value;
  return `${record.name === "@" ? "@" : record.name} ${record.ttl} IN ${record.type} ${value}`;
}

export function buildDnsSetup(settings: DomainSettings = environmentDomainSettings()): DnsSetup {
  const primary = settings.primary;
  const hostname = defaultHostname(primary);
  const selector = defaultDkimSelector();
  const ipv4 = process.env.MAIL_SERVER_IPV4?.trim() || null;
  const ipv6 = process.env.MAIL_SERVER_IPV6?.trim() || null;
  const keys = settings.dkimPublicKeys;
  const catchAll = settings.catchAll;
  const signup = settings.signupDomains;
  const spfOverride = process.env.SPF_RECORD?.trim();
  const dmarcPolicy = (process.env.DMARC_POLICY || "quarantine").trim().toLowerCase();
  const policy = ["none", "quarantine", "reject"].includes(dmarcPolicy) ? dmarcPolicy : "quarantine";

  const allDomains = settings.domains.map((domain) => domain.domain);
  const publicDomains = allDomains.filter((domain) => !isLocalOnlyDomain(domain));
  const localDomains = allDomains.filter(isLocalOnlyDomain);

  const domains: DomainDnsSetup[] = publicDomains.map((domain) => {
    const config = settings.domains.find((item) => item.domain === domain);
    const domainSelector = config?.dkimSelector || selector;
    const key = config?.dkimPublicKey || keys[domain];
    const reportEmail =
      process.env.DMARC_REPORT_EMAIL?.trim() || `dmarc@${domain}`;
    const records: DnsRecord[] = [
      {
        type: "MX",
        name: "@",
        value: `10 ${hostname}.`,
        ttl: 3600,
        purpose: "Route inbound mail to your NyxMail MTA",
        configured: true,
      },
      {
        type: "TXT",
        name: "@",
        value: spfOverride || "v=spf1 mx -all",
        ttl: 3600,
        purpose: "SPF: authorizes the hosts allowed to send as this domain",
        configured: true,
      },
      {
        type: "TXT",
        name: `${domainSelector}._domainkey`,
        value: key ? dkimValue(key) : "",
        ttl: 3600,
        purpose: key
          ? "DKIM public key; the MTA signs with the matching private key"
          : "DKIM public key missing: rotate the key in Settings → Domains or set DKIM_PUBLIC_KEY_MAP",
        configured: Boolean(key),
      },
      {
        type: "TXT",
        name: "_dmarc",
        value: `v=DMARC1; p=${policy}; rua=mailto:${reportEmail}; adkim=s; aspf=s`,
        ttl: 3600,
        purpose: "DMARC policy and aggregate report destination",
        configured: true,
      },
    ];
    if (ipv4) {
      records.push({
        type: "A",
        name: hostname,
        value: ipv4,
        ttl: 3600,
        purpose: "IPv4 address of the mail host",
        configured: true,
      });
    }
    if (ipv6) {
      records.push({
        type: "AAAA",
        name: hostname,
        value: ipv6,
        ttl: 3600,
        purpose: "IPv6 address of the mail host",
        configured: true,
      });
    }
    if (ipv4 || ipv6) {
      records.push({
        type: "PTR",
        name: ipv6 || ipv4 || "your mail IP",
        value: `${hostname}.`,
        ttl: 3600,
        purpose: "Reverse DNS must point at the mail hostname; set it at your VPS provider",
        configured: true,
        providerSide: true,
      });
    }
    const zoneFile = [
      `; NyxMail DNS for ${domain}`,
      ...records.filter((record) => record.type !== "PTR" && record.configured).map(zoneLine),
      "",
    ].join("\n");
    return {
      domain,
      isPrimary: domain === primary,
      isSignupDomain: signup.includes(domain),
      catchAll: Boolean(catchAll[domain]),
      records,
      zoneFile,
    };
  });

  return {
    hostname,
    dkimSelector: selector,
    ipv4,
    ipv6,
    domains,
    localDomains,
    notes: [
      "Publish these records at your DNS provider. TXT values may be shown without quotes by some providers.",
      "Set the PTR/rDNS record at your VPS or IP provider, not in the domain zone.",
      "The MTA hostname must resolve to the mail server that accepts port 25 and posts to /api/v1/ingest.",
      "If outbound mail goes through a relay, change SPF_RECORD to include that relay.",
      "DKIM private keys are encrypted in the NyxMail database or kept on the MTA; only the public key belongs in DNS.",
    ],
  };
}

/** DNS setup including domains added from Settings → Domains. */
export async function buildDnsSetupFromDatabase(): Promise<DnsSetup> {
  return buildDnsSetup(await loadDomainSettings());
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeTxt(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/;+\s*$/, "");
}

function normalizeCompact(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function parseTagList(value: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const raw of value.split(";")) {
    const item = raw.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    const key = item.slice(0, separator).trim().toLowerCase();
    const tagValue = item.slice(separator + 1).trim();
    if (key) tags.set(key, tagValue);
  }
  return tags;
}

function isMissingDnsError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENODATA" || code === "ENOTFOUND" || code === "ENONAME" || code === "EBADNAME";
}

function dnsErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "ETIMEOUT") return "DNS lookup timed out";
  if (code === "SERVFAIL") return "DNS server returned SERVFAIL";
  if (code === "EREFUSED") return "DNS server refused the lookup";
  return error instanceof Error ? error.message : "DNS lookup failed";
}

async function withTimeout<T>(promise: Promise<T>, ms = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("DNS lookup timed out") as Error & { code?: string };
      error.code = "ETIMEOUT";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function txtValues(records: string[][]): string[] {
  return records.map((chunks) => chunks.join("")).filter((value) => value.trim().length > 0);
}

function isCloudflareProxyAddress(address: string): boolean {
  const ip = normalizeHost(address);
  if (!ip.includes(".")) return false;
  const octets = ip.split(".").map(Number);
  const [a, b] = octets;
  if (![a, b].every((part) => Number.isFinite(part))) return false;
  return (
    (a === 104 && b >= 16 && b <= 31) ||
    (a === 172 && b >= 64 && b <= 71) ||
    (a === 188 && b === 114) ||
    a === 162 && b === 158 ||
    a === 198 && b === 41 ||
    (a === 103 && [21, 22, 31].includes(b)) ||
    (a === 141 && b === 101) ||
    (a === 108 && b === 162) ||
    (a === 190 && b === 93) ||
    (a === 131 && b === 0) ||
    (a === 197 && b === 234)
  );
}

function recordFqdn(domain: string, record: DnsRecord): string {
  if (record.type === "A" || record.type === "AAAA" || record.type === "PTR") {
    return record.name;
  }
  if (record.name === "@") return domain;
  return `${record.name}.${domain}`;
}

async function checkRecord(
  domain: string,
  record: DnsRecord,
  resolver: DnsResolver,
): Promise<DnsRecordCheck> {
  const fqdn = recordFqdn(domain, record);
  const result = (
    status: DnsRecordCheckStatus,
    actual: string[],
    detail?: string,
  ): DnsRecordCheck => ({
    type: record.type,
    name: fqdn,
    expected: record.value,
    status,
    actual,
    detail,
  });
  const okResult = (actual: string[], detail?: string) => result("ok", actual, detail);
  const missingResult = (detail = "No matching record was found in public DNS") =>
    result("missing", [], detail);
  const mismatchResult = (
    actual: string[],
    detail = "The published value does not match this server's configuration",
  ) => result("mismatch", actual, detail);
  const failedResult = (detail: string) => result("error", [], detail);

  if (!record.configured || !record.value) {
    return result("not_configured", [], record.purpose);
  }

  try {
    if (record.type === "MX") {
      const actualMx = await withTimeout(resolver.resolveMx(domain));
      const actual = actualMx
        .map((item) => `${item.priority} ${normalizeHost(item.exchange)}`)
        .sort();
      const expected = record.value
        .split(/\s+/)
        .filter(Boolean)
        .map((item, index) => (index === 1 ? normalizeHost(item) : item))
        .join(" ");
      if (actual.length === 0) return missingResult();
      if (actual.length === 1 && actual[0] === expected) return okResult(actual);
      const cloudflareRouting = actualMx.some((item) =>
        /^_dc-mx\./i.test(normalizeHost(item.exchange)),
      );
      return mismatchResult(
        actual,
        cloudflareRouting
          ? "Cloudflare Email Routing is handling inbound mail for this domain; NyxMail is not the MX."
          : undefined,
      );
    }

    if (record.type === "TXT") {
      if (record.name === "@") {
        const values = txtValues(await withTimeout(resolver.resolveTxt(domain)));
        const spf = values.filter((value) => /^v=spf1(?:\s|$)/i.test(value.trim()));
        if (spf.length === 0) return missingResult("No SPF TXT record was found");
        if (spf.length > 1) {
          const expectedSpf = normalizeTxt(record.value);
          const keep = spf.find((value) => normalizeTxt(value) === expectedSpf);
          return mismatchResult(
            spf,
            keep
              ? `Multiple SPF records are published; keep "${record.value}" and remove the others`
              : "Multiple SPF records are published; keep only one",
          );
        }
        if (normalizeTxt(spf[0]) === normalizeTxt(record.value)) return okResult(spf);
        return mismatchResult(spf);
      }

      const values = txtValues(await withTimeout(resolver.resolveTxt(fqdn)));
      if (values.length === 0) return missingResult();

      if (record.name.endsWith("._domainkey")) {
        if (values.length > 1) {
          return mismatchResult(
            values,
            "Multiple DKIM records are published for this selector",
          );
        }
        if (normalizeCompact(values[0]) === normalizeCompact(record.value)) {
          return okResult(values);
        }
        return mismatchResult(values);
      }

      if (record.name === "_dmarc") {
        const dmarc = values.filter((value) => /^v=DMARC1(?:\s*;|$)/i.test(value.trim()));
        if (dmarc.length === 0) return missingResult("No DMARC TXT record was found");
        if (dmarc.length > 1) {
          return mismatchResult(dmarc, "Multiple DMARC records are published; keep only one");
        }
        const expectedTags = parseTagList(record.value);
        const actualTags = parseTagList(dmarc[0]);
        // `v` and `p` are the policy essentials. Reporting/alignment tags are
        // recommendations and may be absent or intentionally different.
        for (const key of ["v", "p"]) {
          const expectedValue = expectedTags.get(key);
          const actualValue = actualTags.get(key);
          if (
            expectedValue &&
            (!actualValue || actualValue.toLowerCase() !== expectedValue.toLowerCase())
          ) {
            return mismatchResult(dmarc, `DMARC tag "${key}" does not match`);
          }
        }
        return okResult(dmarc);
      }

      if (values.some((value) => normalizeTxt(value) === normalizeTxt(record.value))) {
        return okResult(values);
      }
      return mismatchResult(values);
    }

    if (record.type === "A") {
      const actual = await withTimeout(resolver.resolve4(record.name));
      if (actual.length === 0) return missingResult();
      if (actual.map(normalizeHost).includes(normalizeHost(record.value))) {
        return okResult(actual);
      }
      return mismatchResult(
        actual,
        actual.some(isCloudflareProxyAddress)
          ? "This hostname is proxied by Cloudflare. Set the A record to DNS only (grey cloud); SMTP cannot pass through the proxy."
          : undefined,
      );
    }

    if (record.type === "AAAA") {
      const actual = await withTimeout(resolver.resolve6(record.name));
      if (actual.length === 0) return missingResult();
      if (actual.map(normalizeHost).includes(normalizeHost(record.value))) {
        return okResult(actual);
      }
      return mismatchResult(
        actual,
        actual.some(isCloudflareProxyAddress)
          ? "This hostname is proxied by Cloudflare. Set the AAAA record to DNS only (grey cloud); SMTP cannot pass through the proxy."
          : undefined,
      );
    }

    if (record.type === "PTR") {
      const actual = await withTimeout(resolver.reverse(record.name));
      if (actual.length === 0) return missingResult();
      if (actual.map(normalizeHost).includes(normalizeHost(record.value))) {
        return okResult(actual);
      }
      return mismatchResult(actual);
    }
  } catch (error) {
    if (isMissingDnsError(error)) return missingResult();
    return failedResult(dnsErrorMessage(error));
  }

  return failedResult("Unsupported DNS record type");
}

export async function checkDnsSetup(
  setup: DnsSetup = buildDnsSetup(),
  resolver: DnsResolver = createCloudflareResolver(),
): Promise<DnsCheckResult> {
  const checkedAt = new Date().toISOString();
  const domains = await Promise.all(
    setup.domains.map(async (domain) => {
      const records = await Promise.all(
        domain.records.map((record) => checkRecord(domain.domain, record, resolver)),
      );
      const status = records.every((record) => record.status === "ok")
        ? "ok"
        : records.some((record) =>
              ["missing", "mismatch", "error"].includes(record.status),
            )
          ? "error"
          : "warning";
      return {
        domain: domain.domain,
        status,
        checkedAt,
        records,
      } satisfies DomainDnsCheck;
    }),
  );
  return { checkedAt, provider: resolver.label ?? "DNS", domains };
}
