/**
 * Fail fast in production-like runtime if the required secrets are absent.
 * Imported dynamically so the check never runs in the browser bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertRuntimeSecrets } = await import("./lib/env");
  assertRuntimeSecrets();
}
