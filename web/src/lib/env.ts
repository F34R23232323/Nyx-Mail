export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function cookieSecure(): boolean {
  return appUrl().startsWith("https://") || isProduction();
}

export function rpId(): string {
  try {
    return new URL(appUrl()).hostname;
  } catch {
    return "localhost";
  }
}

export function expectedOrigin(): string {
  return appUrl();
}

export function maxStorageBytes(): number {
  return Number(process.env.DEFAULT_STORAGE_LIMIT_BYTES || 1_610_612_736);
}

const EXAMPLE_SECRETS = new Set([
  "replace-with-a-long-random-string-at-least-32-bytes",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "replace-with-another-long-random-string",
  "replace-with-a-long-random-hmac-secret",
]);

export function assertRuntimeSecrets(): void {
  const encryptionKey = env("APP_ENCRYPTION_KEY");
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey) && Buffer.from(encryptionKey, "base64").length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes");
  }
  const jwt = env("JWT_SECRET");
  if (jwt.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  env("RECOVERY_PEPPER");
  env("INGEST_SECRET");

  for (const name of [
    "APP_ENCRYPTION_KEY",
    "JWT_SECRET",
    "RECOVERY_PEPPER",
    "INGEST_SECRET",
  ] as const) {
    if (EXAMPLE_SECRETS.has(process.env[name] ?? "")) {
      throw new Error(`${name} still uses the example value; run npm run keys:secrets`);
    }
  }
}
