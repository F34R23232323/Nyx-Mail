import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80") ||
      value.startsWith("::ffff:127.") ||
      value.startsWith("::ffff:10.") ||
      value.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

/** IMAP credentials are a powerful SSRF primitive. Unless explicitly allowed,
 * imports may only connect to public hostnames. */
export async function assertPublicHost(host: string): Promise<void> {
  if (process.env.IMAP_ALLOW_PRIVATE_HOSTS === "true") return;
  const normalized = host.trim().toLowerCase();
  if (!normalized || normalized === "localhost" || normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    throw new Error("Private IMAP hosts are disabled on this server");
  }
  const addresses = isIP(normalized)
    ? [{ address: normalized }]
    : await dns.lookup(normalized, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("IMAP host resolves to a private address; set IMAP_ALLOW_PRIVATE_HOSTS=true to allow it");
  }
}

/** Proton Bridge normally listens on loopback. Allow that without opening
 * arbitrary private-network IMAP targets; remote/private hosts still require
 * IMAP_ALLOW_PRIVATE_HOSTS=true. */
export async function assertProtonBridgeHost(host: string): Promise<void> {
  const normalized = host.trim().toLowerCase();
  if (["127.0.0.1", "::1", "localhost"].includes(normalized)) return;
  await assertPublicHost(host);
}
