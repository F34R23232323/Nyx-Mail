import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateSpam } from "../src/spam";
import { learnWithRspamd } from "../src/rspamd";

const baseContext = {
  fromAddress: "sender@example.com",
  subject: "Hello",
  text: "A normal message.",
  filters: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("built-in spam heuristics", () => {
  it("flags an obvious scam with failed authentication", async () => {
    const result = await evaluateSpam({
      ...baseContext,
      subject: "FINAL NOTICE: claim your prize!!",
      text: "Wire transfer required. Send your seed phrase and claim your prize. Act now!",
      spf: "fail",
      dkim: "fail",
      dmarc: "fail",
    });
    expect(result.spam).toBe(true);
    expect(result.engine).toBe("local");
    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.reasons.join(" ")).toContain("spam phrases");
  });

  it("honours allow and block filters", async () => {
    const allowed = await evaluateSpam({
      ...baseContext,
      filters: [{ kind: "ALLOW", pattern: "example.com" }],
      spf: "fail",
      dmarc: "fail",
    });
    expect(allowed.spam).toBe(false);
    expect(allowed.engine).toBe("filter");

    const blocked = await evaluateSpam({
      ...baseContext,
      filters: [{ kind: "BLOCK", pattern: "sender@example.com" }],
    });
    expect(blocked.spam).toBe(true);
    expect(blocked.score).toBe(100);
  });

  it("does not flag ordinary mail from an authenticated sender", async () => {
    const result = await evaluateSpam({
      ...baseContext,
      fromAddress: "alex@example.com",
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
      knownSender: true,
    });
    expect(result.spam).toBe(false);
    expect(result.score).toBeLessThan(5);
  });
});

describe("rspamd integration", () => {
  it("uses /checkv2 JSON and exposes every symbol hit", async () => {
    vi.stubEnv("RSPAMD_URL", "http://127.0.0.1:11333");
    vi.stubEnv("RSPAMD_CONTROLLER_URL", "http://127.0.0.1:11334");
    vi.stubEnv("RSPAMD_PASSWORD", "secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:11333/checkv2");
      const headers = new Headers(init?.headers);
      expect(headers.get("From")).toBe("spammer@example.com");
      expect(headers.get("User")).toBe("user-1");
      expect(headers.get("Rcpt")).toBe("victim@example.com");
      return new Response(
        JSON.stringify({
          score: 8.4,
          required_score: 15,
          action: "add header",
          is_skipped: false,
          symbols: {
            BAYES_SPAM: { name: "BAYES_SPAM", score: 5.2, options: ["95%"] },
            URIBL_BLOCKED: { name: "URIBL_BLOCKED", score: 3.2 },
          },
          urls: ["bad.example"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateSpam({
      ...baseContext,
      fromAddress: "spammer@example.com",
      raw: Buffer.from("From: spammer@example.com\r\nSubject: test\r\n\r\nbody"),
      recipient: "victim@example.com",
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.engine).toBe("rspamd");
    expect(result.spam).toBe(true);
    expect(result.score).toBe(8.4);
    expect(result.action).toBe("add header");
    expect(result.symbols?.map((symbol) => symbol.name)).toEqual([
      "BAYES_SPAM",
      "URIBL_BLOCKED",
    ]);
  });

  it("keeps built-in signals when Rspamd returns a low score", async () => {
    vi.stubEnv("RSPAMD_URL", "http://127.0.0.1:11333");
    vi.stubEnv("RSPAMD_CONTROLLER_URL", "http://127.0.0.1:11334");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            score: 0.4,
            required_score: 15,
            action: "no action",
            is_skipped: false,
            symbols: { MIME_GOOD: { name: "MIME_GOOD", score: -0.1 } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await evaluateSpam({
      ...baseContext,
      fromAddress: "scammer@example.org",
      subject: "FINAL NOTICE: claim your prize!!",
      text: "Wire transfer required. Send your seed phrase and claim your prize. Act now!",
      raw: Buffer.from("From: scammer@example.org\r\nSubject: claim your prize\r\n\r\nAct now"),
    });
    expect(result.engine).toBe("rspamd");
    expect(result.spam).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(5);
  });

  it("feeds user reports to /learnspam and /learnham", async () => {
    vi.stubEnv("RSPAMD_URL", "http://127.0.0.1:11333");
    vi.stubEnv("RSPAMD_CONTROLLER_URL", "http://127.0.0.1:11334");
    vi.stubEnv("RSPAMD_PASSWORD", "secret");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Password")).toBe("secret");
      expect(headers.get("User")).toBe("user-1");
      expect(String(input)).toMatch(/\/(learnspam|learnham)$/);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const spam = await learnWithRspamd({
      raw: Buffer.from("spam message"),
      spam: true,
      from: "spammer@example.com",
      user: "user-1",
    });
    const ham = await learnWithRspamd({
      raw: Buffer.from("ham message"),
      spam: false,
      from: "friend@example.com",
      user: "user-1",
    });

    expect(spam.learned).toBe(true);
    expect(ham.learned).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:11334/learnspam",
      "http://127.0.0.1:11334/learnham",
    ]);
  });
});
