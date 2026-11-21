import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDnsSetup, checkDnsSetup, type DnsResolver } from "../src/dns";
import type { DomainSettings } from "../src/domains";

const keys = [
  "MAIL_DOMAIN",
  "MAIL_DOMAINS",
  "SIGNUP_DOMAINS",
  "CATCH_ALL_MAP",
  "MAIL_HOSTNAME",
  "MAIL_SERVER_IPV4",
  "MAIL_SERVER_IPV6",
  "DKIM_SELECTOR",
  "DKIM_PUBLIC_KEY_MAP",
  "DKIM_PUBLIC_KEY",
  "SPF_RECORD",
  "DMARC_POLICY",
  "DMARC_REPORT_EMAIL",
  "APP_URL",
] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of keys) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of keys) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("DNS setup records", () => {
  it("builds MX, SPF, DKIM, DMARC, address and PTR records", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.MAIL_DOMAINS = "example.com,example.net";
    process.env.SIGNUP_DOMAINS = "example.com";
    process.env.CATCH_ALL_MAP = JSON.stringify({ "example.net": "you@example.com" });
    process.env.MAIL_HOSTNAME = "mail.example.com";
    process.env.MAIL_SERVER_IPV4 = "203.0.113.10";
    process.env.MAIL_SERVER_IPV6 = "2001:db8::10";
    process.env.DKIM_SELECTOR = "nyxmail";
    process.env.DKIM_PUBLIC_KEY_MAP = JSON.stringify({
      "example.com": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
      "example.net": "v=DKIM1; k=rsa; p=ABC123",
    });

    const setup = buildDnsSetup();
    expect(setup.hostname).toBe("mail.example.com");
    expect(setup.domains.map((domain) => domain.domain)).toEqual(["example.com", "example.net"]);

    const primary = setup.domains[0];
    expect(primary.isPrimary).toBe(true);
    expect(primary.isSignupDomain).toBe(true);
    expect(primary.records.find((record) => record.type === "MX")?.value).toBe("10 mail.example.com.");
    expect(primary.records.find((record) => record.type === "TXT" && record.name === "@")?.value).toBe(
      "v=spf1 mx -all",
    );
    expect(
      primary.records.find((record) => record.name === "nyxmail._domainkey")?.value,
    ).toContain("p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A");
    expect(primary.records.find((record) => record.name === "_dmarc")?.value).toBe(
      "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; adkim=s; aspf=s",
    );
    expect(primary.records.find((record) => record.type === "A")?.value).toBe("203.0.113.10");
    expect(primary.records.find((record) => record.type === "AAAA")?.value).toBe("2001:db8::10");
    expect(primary.records.find((record) => record.type === "PTR")?.providerSide).toBe(true);

    const catchAllDomain = setup.domains.find((domain) => domain.domain === "example.net");
    expect(catchAllDomain?.catchAll).toBe(true);
    expect(catchAllDomain?.isSignupDomain).toBe(false);
    expect(
      catchAllDomain?.records.find((record) => record.name === "nyxmail._domainkey")?.value,
    ).toBe("v=DKIM1;k=rsa;p=ABC123");
    expect(catchAllDomain?.zoneFile).toContain("NyxMail DNS for example.net");
  });

  it("marks a missing DKIM key instead of inventing one", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.MAIL_HOSTNAME = "mail.example.com";
    const setup = buildDnsSetup();
    const record = setup.domains[0].records.find((item) => item.name === "nyxmail._domainkey");
    expect(record?.configured).toBe(false);
    expect(record?.value).toBe("");
  });

  it("honors SPF and DMARC overrides", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.SPF_RECORD = "v=spf1 include:relay.example -all";
    process.env.DMARC_POLICY = "reject";
    process.env.DMARC_REPORT_EMAIL = "dmarc@example.net";
    const setup = buildDnsSetup();
    expect(
      setup.domains[0].records.find(
        (record) => record.type === "TXT" && record.name === "@",
      )?.value,
    ).toBe("v=spf1 include:relay.example -all");
    expect(setup.domains[0].records.find((record) => record.name === "_dmarc")?.value).toContain(
      "rua=mailto:dmarc@example.net",
    );
  });

  it("omits local-only domains from public DNS checks", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.MAIL_DOMAINS = "example.com,localhost";
    process.env.MAIL_HOSTNAME = "mail.example.com";
    const setup = buildDnsSetup();
    expect(setup.domains.map((domain) => domain.domain)).toEqual(["example.com"]);
    expect(setup.localDomains).toEqual(["localhost"]);
  });

  it("renders domains and per-domain keys from runtime settings", () => {
    process.env.MAIL_HOSTNAME = "mail.example.com";
    process.env.MAIL_SERVER_IPV4 = "203.0.113.10";
    const settings: DomainSettings = {
      primary: "example.com",
      domains: [
        {
          domain: "example.com",
          isPrimary: true,
          allowSignup: true,
          catchAllAddress: null,
          dkimSelector: "nyxmail",
          dkimPublicKey: "PRIMARYKEY",
          fromEnvironment: true,
          managed: false,
        },
        {
          domain: "newdomain.tld",
          isPrimary: false,
          allowSignup: false,
          catchAllAddress: "you@example.com",
          dkimSelector: "runtime",
          dkimPublicKey: "NEWKEY",
          fromEnvironment: false,
          managed: true,
        },
      ],
      signupDomains: ["example.com"],
      catchAll: { "newdomain.tld": "you@example.com" },
      dkimPublicKeys: { "example.com": "PRIMARYKEY", "newdomain.tld": "NEWKEY" },
    };

    const setup = buildDnsSetup(settings);
    expect(setup.domains.map((domain) => domain.domain)).toEqual(["example.com", "newdomain.tld"]);
    expect(setup.domains[0].isSignupDomain).toBe(true);
    expect(
      setup.domains[0].records.find((record) => record.name === "nyxmail._domainkey")?.value,
    ).toContain("PRIMARYKEY");
    const added = setup.domains[1];
    expect(added.catchAll).toBe(true);
    expect(added.isSignupDomain).toBe(false);
    expect(
      added.records.find((record) => record.name === "runtime._domainkey")?.value,
    ).toContain("NEWKEY");
  });
});

function checkedSetup() {
  process.env.MAIL_DOMAIN = "example.com";
  process.env.MAIL_HOSTNAME = "mail.example.com";
  process.env.DKIM_SELECTOR = "nyxmail";
  process.env.DKIM_PUBLIC_KEY_MAP = JSON.stringify({ "example.com": "ABC123" });
  process.env.DMARC_POLICY = "quarantine";
  return buildDnsSetup();
}

function fakeResolver(overrides: Partial<DnsResolver> = {}): DnsResolver {
  return {
    resolveMx: async () => [{ priority: 10, exchange: "mail.example.com." }],
    resolveTxt: async (name) => {
      if (name === "example.com") return [["v=spf1 mx -all"]];
      if (name === "nyxmail._domainkey.example.com") {
        return [["v=DKIM1; k=rsa; p=ABC123"]];
      }
      if (name === "_dmarc.example.com") {
        return [["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; adkim=s; aspf=s"]];
      }
      throw Object.assign(new Error("no data"), { code: "ENODATA" });
    },
    resolve4: async () => [],
    resolve6: async () => [],
    reverse: async () => [],
    ...overrides,
  };
}

describe("DNS status checks", () => {
  it("marks matching records as verified", async () => {
    const result = await checkDnsSetup(checkedSetup(), fakeResolver());
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0].status).toBe("ok");
    expect(result.domains[0].records.every((record) => record.status === "ok")).toBe(true);
    expect(result.domains[0].records.map((record) => record.name)).toEqual([
      "example.com",
      "example.com",
      "nyxmail._domainkey.example.com",
      "_dmarc.example.com",
    ]);
  });

  it("reports a missing DKIM record", async () => {
    const result = await checkDnsSetup(
      checkedSetup(),
      fakeResolver({
        resolveTxt: async (name) => {
          if (name === "nyxmail._domainkey.example.com") {
            throw Object.assign(new Error("no data"), { code: "ENODATA" });
          }
          if (name === "_dmarc.example.com") {
            return [["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; adkim=s; aspf=s"]];
          }
          return [["v=spf1 mx -all"]];
        },
      }),
    );
    const dkim = result.domains[0].records.find((record) => record.name.includes("._domainkey"));
    expect(dkim?.status).toBe("missing");
    expect(result.domains[0].status).toBe("error");
  });

  it("accepts a valid DMARC policy without optional reporting tags", async () => {
    const result = await checkDnsSetup(
      checkedSetup(),
      fakeResolver({
        resolveTxt: async (name) => {
          if (name === "_dmarc.example.com") return [["v=DMARC1; p=quarantine"]];
          if (name === "example.com") return [["v=spf1 mx -all"]];
          if (name === "nyxmail._domainkey.example.com") {
            return [["v=DKIM1; k=rsa; p=ABC123"]];
          }
          throw Object.assign(new Error("no data"), { code: "ENODATA" });
        },
      }),
    );
    const dmarc = result.domains[0].records.find((record) => record.name === "_dmarc.example.com");
    expect(dmarc?.status).toBe("ok");
  });

  it("reports SPF mismatches and multiple SPF records", async () => {
    const result = await checkDnsSetup(
      checkedSetup(),
      fakeResolver({
        resolveTxt: async (name) => {
          if (name === "example.com") {
            return [["v=spf1 mx -all"], ["v=spf1 include:other.example -all"]];
          }
          if (name === "nyxmail._domainkey.example.com") {
            return [["v=DKIM1; k=rsa; p=ABC123"]];
          }
          if (name === "_dmarc.example.com") {
            return [["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; adkim=s; aspf=s"]];
          }
          throw Object.assign(new Error("no data"), { code: "ENODATA" });
        },
      }),
    );
    const spf = result.domains[0].records.find(
      (record) => record.name === "example.com" && record.type === "TXT",
    );
    expect(spf?.status).toBe("mismatch");
    expect(spf?.detail).toContain("Multiple SPF records");
  });
});
