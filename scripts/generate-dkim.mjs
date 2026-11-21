#!/usr/bin/env node
/**
 * Generate a DKIM RSA key pair, keep the private key out of the web root and
 * write the matching public key into DKIM_PUBLIC_KEY_MAP in the server .env.
 *
 * Usage:
 *   npm run dkim:generate -- example.com
 *   npm run dkim:generate -- example.com --force
 */
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });

const args = process.argv.slice(2);
const force = args.includes("--force");
const domainArg = args.find((arg) => !arg.startsWith("--"));
const domain = (domainArg || process.env.MAIL_DOMAIN || "").trim().toLowerCase();

if (!domain) {
  console.error("Usage: npm run dkim:generate -- <domain> [--force]");
  process.exit(1);
}
if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
  console.error(`"${domain}" is not a public domain name. DKIM is only needed for public domains.`);
  process.exit(1);
}

const selector = (process.env.DKIM_SELECTOR || "nyxmail").trim().replace(/\.$/, "");
const envPath = resolve(root, ".env");
const keyDir = resolve(root, "config", "dkim");
const privatePath = resolve(keyDir, `${domain}.private`);

if (!existsSync(envPath)) {
  console.error(`Missing ${envPath}`);
  process.exit(1);
}

let privateKey;
if (existsSync(privatePath) && !force) {
  privateKey = readFileSync(privatePath, "utf8");
  console.log(`Reusing existing private key: ${privatePath}`);
} else {
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKey = pair.privateKey;
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  chmodSync(privatePath, 0o600);
  console.log(`Generated a 2048-bit DKIM key: ${privatePath}`);
}

const publicKey = createPublicKey(privateKey)
  .export({ type: "spki", format: "der" })
  .toString("base64");

let env = readFileSync(envPath, "utf8");
const map = {};
const current = env.match(/^DKIM_PUBLIC_KEY_MAP=(.*)$/m);
if (current) {
  try {
    const raw = current[1].trim().replace(/^(['"])(.*)\1$/, "$2");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.trim()) map[key.toLowerCase()] = value;
      }
    }
  } catch {
    console.warn("Existing DKIM_PUBLIC_KEY_MAP is not valid JSON; replacing it.");
  }
}
map[domain] = publicKey;
const line = `DKIM_PUBLIC_KEY_MAP='${JSON.stringify(map)}'`;
if (current) {
  env = env.replace(/^DKIM_PUBLIC_KEY_MAP=.*$/m, line);
} else {
  env = `${env.replace(/\s*$/, "")}\n${line}\n`;
}
writeFileSync(envPath, env);

const recordName = `${selector}._domainkey.${domain}`;
const recordValue = `v=DKIM1; k=rsa; p=${publicKey}`;
console.log("");
console.log(`DKIM is configured for ${domain}.`);
console.log(`Private key:   ${privatePath}`);
console.log(`DNS record:    ${recordName}`);
console.log(`TXT value:     ${recordValue}`);
console.log("");
console.log("Publish that TXT record, point your MTA/OpenDKIM at the private key,");
console.log("then restart the web process and worker.");
