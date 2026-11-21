import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRuntimeSecrets } from "../../src/lib/env";

const VALID_KEY = "1".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime secret validation", () => {
  it("accepts generated secrets", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", VALID_KEY);
    vi.stubEnv("JWT_SECRET", "a".repeat(48));
    vi.stubEnv("RECOVERY_PEPPER", "a-recovery-pepper");
    vi.stubEnv("INGEST_SECRET", "an-ingest-secret");
    expect(() => assertRuntimeSecrets()).not.toThrow();
  });

  it("rejects the example encryption key", () => {
    vi.stubEnv(
      "APP_ENCRYPTION_KEY",
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    vi.stubEnv("JWT_SECRET", "a".repeat(48));
    vi.stubEnv("RECOVERY_PEPPER", "a-recovery-pepper");
    vi.stubEnv("INGEST_SECRET", "an-ingest-secret");
    expect(() => assertRuntimeSecrets()).toThrow(/example value/);
  });

  it("rejects a short JWT secret", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", VALID_KEY);
    vi.stubEnv("JWT_SECRET", "too-short");
    vi.stubEnv("RECOVERY_PEPPER", "a-recovery-pepper");
    vi.stubEnv("INGEST_SECRET", "an-ingest-secret");
    expect(() => assertRuntimeSecrets()).toThrow(/at least 32/);
  });
});
