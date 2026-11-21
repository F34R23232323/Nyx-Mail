import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  catchAllMap,
  catchAllTargetFor,
  catchAllTargetForAddress,
  isMailDomain,
  isSignupDomain,
  mailDomains,
  primaryMailDomain,
  signupDomains,
} from "../src/domains";

const ENV_KEYS = [
  "MAIL_DOMAIN",
  "MAIL_DOMAINS",
  "SIGNUP_DOMAINS",
  "CATCH_ALL_MAP",
  "CATCH_ALL_DOMAIN",
  "CATCH_ALL_ADDRESS",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("custom mail domains", () => {
  it("falls back to localhost when no domain is configured", () => {
    expect(primaryMailDomain()).toBe("localhost");
    expect(mailDomains()).toEqual(["localhost"]);
    expect(signupDomains()).toEqual(["localhost"]);
  });

  it("keeps MAIL_DOMAIN primary while accepting MAIL_DOMAINS", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.MAIL_DOMAINS = "example.com, example.net";
    expect(primaryMailDomain()).toBe("example.com");
    expect(mailDomains()).toEqual(["example.com", "example.net"]);
    expect(isMailDomain("EXAMPLE.NET")).toBe(true);
  });

  it("defaults signup to the primary domain only", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.MAIL_DOMAINS = "example.com,example.net";
    expect(signupDomains()).toEqual(["example.com"]);
    expect(isSignupDomain("example.net")).toBe(false);
  });

  it("allows explicit signup domains", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.MAIL_DOMAINS = "example.com,example.net";
    process.env.SIGNUP_DOMAINS = "example.net";
    expect(signupDomains()).toEqual(["example.net"]);
    expect(isSignupDomain("example.net")).toBe(true);
  });

  it("discards signup domains that are not configured for mail", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.SIGNUP_DOMAINS = "unconfigured.example";
    expect(signupDomains()).toEqual(["example.com"]);
  });
});

describe("catch-all configuration", () => {
  it("parses a JSON catch-all map", () => {
    process.env.MAIL_DOMAIN = "example.com";
    process.env.CATCH_ALL_MAP = JSON.stringify({
      "example.net": "you@example.com",
    });
    expect(catchAllMap()).toEqual({ "example.net": "you@example.com" });
    expect(catchAllTargetForAddress("anything@EXAMPLE.NET")).toBe("you@example.com");
    expect(mailDomains()).toContain("example.net");
  });

  it("parses domain=address syntax", () => {
    process.env.CATCH_ALL_MAP = "example.net=you@example.com,other.dev=team@example.com";
    expect(catchAllTargetFor("example.net")).toBe("you@example.com");
    expect(catchAllTargetFor("other.dev")).toBe("team@example.com");
  });

  it("supports the single-domain shorthand", () => {
    process.env.CATCH_ALL_DOMAIN = "example.net";
    process.env.CATCH_ALL_ADDRESS = "you@example.com";
    expect(catchAllTargetFor("example.net")).toBe("you@example.com");
  });

  it("ignores malformed catches", () => {
    process.env.CATCH_ALL_MAP = "{not-json";
    process.env.CATCH_ALL_DOMAIN = "bad domain";
    process.env.CATCH_ALL_ADDRESS = "not-an-email";
    expect(catchAllMap()).toEqual({});
  });
});
