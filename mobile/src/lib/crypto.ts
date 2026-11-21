/**
 * NyxMail mobile cryptography.
 *
 * The wire formats are byte-for-byte identical to `@nyxmail/crypto` on the web:
 *   nyx1.<b64 nonce>.<b64 secretbox>       — subject / body / key bundle
 *   nyxatt1.<b64 nonce>.<b64 aead>         — encrypted attachment bytes
 *   base64(crypto_box_seal(msg key))       — per-recipient wrapped message key
 *
 * libsodium-wrappers needs WebAssembly, which Hermes does not have. This module
 * therefore uses TweetNaCl (XSalsa20-Poly1305 + X25519) and Noble (Argon2id,
 * BLAKE2b, XChaCha20-Poly1305). All primitives are audited, pure JavaScript and
 * produce the exact same bytes as libsodium.
 */
import nacl from "tweetnacl";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { md5 } from "@noble/hashes/legacy.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export interface KeyBundle {
  version: 1;
  publicKey: string;
  privateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
}

export interface KeyEnvelope {
  argonSalt: string;
  encryptedPrivateKey: string;
}

export interface DecryptedBody {
  html: string;
  text: string;
  attachments: ClientAttachmentMeta[];
}

export interface AttachmentMeta {
  id?: string;
  blobId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string | null;
  inline?: boolean;
}

export interface ClientAttachmentMeta extends AttachmentMeta {
  key: string;
}

const SECRETBOX_PREFIX = "nyx1";
const AEAD_PREFIX = "nyxatt1";
const ARGON_SALT_BYTES = 16;
const SECRETBOX_NONCE_BYTES = 24;
const SECRETBOX_KEY_BYTES = 32;
const XCHACHA_NONCE_BYTES = 24;

let randomSource: ((length: number) => Uint8Array) | null = null;

/** Installed once at app boot with expo-crypto's native CSPRNG. */
export function setRandomSource(source: (length: number) => Uint8Array): void {
  randomSource = source;
  nacl.setPRNG((target, length) => {
    const bytes = source(length);
    for (let index = 0; index < length; index += 1) target[index] = bytes[index];
  });
}

export function randomBytes(length: number): Uint8Array {
  if (randomSource) return randomSource(length);
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues) {
    const out = new Uint8Array(length);
    webCrypto.getRandomValues(out);
    return out;
  }
  return nacl.randomBytes(length);
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < B64_ALPHABET.length; index += 1) {
    table[B64_ALPHABET.charCodeAt(index)] = index;
  }
  table["=".charCodeAt(0)] = -2;
  return table;
})();

export function toBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += B64_ALPHABET[(triplet >> 18) & 63];
    output += B64_ALPHABET[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? B64_ALPHABET[(triplet >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? B64_ALPHABET[triplet & 63] : "=";
  }
  return output;
}

export function fromBase64(value: string): Uint8Array {
  const cleaned = value.trim().replace(/\s+/g, "");
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < cleaned.length; index += 1) {
    const code = cleaned.charCodeAt(index);
    const decoded = code < 128 ? B64_LOOKUP[code] : -1;
    if (decoded === -2) break;
    if (decoded < 0) throw new Error("Invalid base64 value");
    buffer = (buffer << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

function utf8(value: string): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      output.push(codePoint);
    } else if (codePoint < 0x800) {
      output.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      output.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      output.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(output);
}

function text(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    let codePoint = 0;
    let length = 0;
    if (first < 0x80) {
      codePoint = first;
      length = 1;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      length = 2;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      length = 3;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      length = 4;
    } else {
      throw new Error("Invalid UTF-8");
    }
    if (index + length > bytes.length) throw new Error("Invalid UTF-8");
    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) throw new Error("Invalid UTF-8");
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (codePoint > 0xffff) {
      const adjusted = codePoint - 0x10000;
      output += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    } else {
      output += String.fromCharCode(codePoint);
    }
    index += length;
  }
  return output;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function envelope(prefix: string, nonce: Uint8Array, ciphertext: Uint8Array): string {
  return `${prefix}.${toBase64(nonce)}.${toBase64(ciphertext)}`;
}

function splitEnvelope(prefix: string, value: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) throw new Error("Corrupted encrypted value");
  return { nonce: fromBase64(parts[1]), ciphertext: fromBase64(parts[2]) };
}

function secretbox(plaintext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  return nacl.secretbox(plaintext, nonce, key);
}

// ---------------------------------------------------------------------------
// Key derivation and private key bundle
// ---------------------------------------------------------------------------

/**
 * libsodium's crypto_pwhash_OPSLIMIT_INTERACTIVE / MEMLIMIT_INTERACTIVE.
 * The web app uses these values (2 iterations, 64 MiB, Argon2id v1.3).
 */
export const KDF_PARAMS = {
  opsLimit: 2,
  memLimit: 64 * 1024 * 1024,
  algorithm: "Argon2id" as const,
};

export async function deriveKeyFromPassword(
  password: string,
  argonSaltB64: string,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (!password) throw new Error("Password is required");
  const salt = fromBase64(argonSaltB64);
  if (salt.length !== ARGON_SALT_BYTES) throw new Error("Invalid Argon2 salt");

  // Native Argon2 (argon2kt) is roughly two orders of magnitude faster than
  // JS on Hermes. The JS path remains as a fallback (Expo Go, web, tests).
  try {
    const native = await deriveWithNativeArgon2(password, salt);
    if (native) {
      onProgress?.(1);
      return native;
    }
  } catch {
    // native module unavailable — fall through
  }

  let lastProgress = -1;
  const key = await argon2idAsync(utf8(password), salt, {
    t: KDF_PARAMS.opsLimit,
    m: 64 * 1024,
    p: 1,
    dkLen: 32,
    version: 0x13,
    asyncTick: 8,
    onProgress: (fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent !== lastProgress) {
        lastProgress = percent;
        onProgress?.(fraction);
      }
    },
  });
  return key as Uint8Array;
}

type NativeArgon2 = (
  password: string,
  salt: string,
  options: Record<string, unknown>,
) => Promise<{ rawHash: string }>;

let nativeArgon2: NativeArgon2 | null = null;
let nativeArgon2Failed = false;

async function deriveWithNativeArgon2(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array | null> {
  if (nativeArgon2Failed) return null;
  if (!nativeArgon2) {
    try {
      const loaded = await import("react-native-argon2");
      nativeArgon2 = ((loaded as { default?: NativeArgon2 }).default ??
        (loaded as unknown as NativeArgon2)) as NativeArgon2;
      if (typeof nativeArgon2 !== "function") throw new Error("not available");
    } catch {
      nativeArgon2Failed = true;
      return null;
    }
  }
  const saltHex = Array.from(salt)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const result = await nativeArgon2(password, saltHex, {
    iterations: KDF_PARAMS.opsLimit,
    memory: 64 * 1024,
    parallelism: 1,
    hashLength: 32,
    mode: "argon2id",
    saltEncoding: "hex",
  });
  const hash = result?.rawHash;
  if (!hash || hash.length !== 64) throw new Error("Unexpected Argon2 output");
  const key = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    key[index] = Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16);
  }
  return key;
}

export function assertKeyBundle(value: unknown): asserts value is KeyBundle {
  if (!value || typeof value !== "object") throw new Error("Invalid key bundle");
  const bundle = value as Partial<KeyBundle>;
  if (
    bundle.version !== 1 ||
    typeof bundle.publicKey !== "string" ||
    typeof bundle.privateKey !== "string" ||
    typeof bundle.signingPublicKey !== "string" ||
    typeof bundle.signingPrivateKey !== "string"
  ) {
    throw new Error("Invalid key bundle");
  }
}

export async function decryptKeyBundle(encrypted: string, key: Uint8Array): Promise<KeyBundle> {
  try {
    const { nonce, ciphertext } = splitEnvelope(SECRETBOX_PREFIX, encrypted);
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    if (!plaintext) throw new Error("bad key");
    const parsed: unknown = JSON.parse(text(plaintext));
    assertKeyBundle(parsed);
    return parsed;
  } catch {
    throw new Error("Incorrect password");
  }
}

export async function unlockKeyBundle(
  encryptedPrivateKey: string,
  argonSalt: string,
  password: string,
  onProgress?: (fraction: number) => void,
): Promise<KeyBundle> {
  const key = await deriveKeyFromPassword(password, argonSalt, onProgress);
  try {
    return await decryptKeyBundle(encryptedPrivateKey, key);
  } finally {
    key.fill(0);
  }
}

export async function generateKeyBundle(): Promise<KeyBundle> {
  const box = nacl.box.keyPair();
  const sign = nacl.sign.keyPair();
  return {
    version: 1,
    publicKey: toBase64(box.publicKey),
    privateKey: toBase64(box.secretKey),
    signingPublicKey: toBase64(sign.publicKey),
    signingPrivateKey: toBase64(sign.secretKey),
  };
}

export async function createKeyEnvelope(
  bundle: KeyBundle,
  password: string,
  onProgress?: (fraction: number) => void,
): Promise<KeyEnvelope> {
  const argonSalt = toBase64(randomBytes(ARGON_SALT_BYTES));
  const key = await deriveKeyFromPassword(password, argonSalt, onProgress);
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const encryptedPrivateKey = envelope(
    SECRETBOX_PREFIX,
    nonce,
    secretbox(utf8(JSON.stringify(bundle)), key, nonce),
  );
  key.fill(0);
  return { argonSalt, encryptedPrivateKey };
}

// ---------------------------------------------------------------------------
// Message keys, sealed boxes and message encryption
// ---------------------------------------------------------------------------

export function sealToPublicKey(message: Uint8Array, recipientPublicKeyB64: string): Uint8Array {
  const recipientKey = fromBase64(recipientPublicKeyB64);
  if (recipientKey.length !== 32) throw new Error("Invalid recipient public key");
  const ephemeral = nacl.box.keyPair();
  // crypto_box_seal nonce = BLAKE2b(ephemeral_pk || recipient_pk, 24)
  const nonce = blake2b(concat(ephemeral.publicKey, recipientKey), { dkLen: 24 }) as Uint8Array;
  const box = nacl.box(message, nonce, recipientKey, ephemeral.secretKey);
  return concat(ephemeral.publicKey, box);
}

export function openSealedBox(
  sealed: Uint8Array,
  publicKeyB64: string,
  privateKeyB64: string,
): Uint8Array | null {
  if (sealed.length < 32 + 16) return null;
  const ephemeralPublicKey = sealed.slice(0, 32);
  const ciphertext = sealed.slice(32);
  const publicKey = fromBase64(publicKeyB64);
  const privateKey = fromBase64(privateKeyB64);
  const nonce = blake2b(concat(ephemeralPublicKey, publicKey), { dkLen: 24 }) as Uint8Array;
  return nacl.box.open(ciphertext, nonce, ephemeralPublicKey, privateKey);
}

export function unwrapMessageKey(
  wrappedKeyB64: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Uint8Array {
  const opened = openSealedBox(fromBase64(wrappedKeyB64), publicKeyB64, privateKeyB64);
  if (!opened || opened.length !== SECRETBOX_KEY_BYTES) {
    throw new Error("This message was not encrypted for this key");
  }
  return opened;
}

function openSecretbox(value: string, key: Uint8Array): string {
  const { nonce, ciphertext } = splitEnvelope(SECRETBOX_PREFIX, value);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error("bad ciphertext");
  return text(plaintext);
}

function closeSecretbox(value: string, key: Uint8Array): string {
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  return envelope(SECRETBOX_PREFIX, nonce, secretbox(utf8(value), key, nonce));
}

export interface SealedPayload {
  encryptedSubject: string;
  encryptedBody: string;
  wraps: Record<string, string>;
  sizeBytes: number;
}

export async function encryptMessageForRecipients<T>(
  subject: string,
  payload: T,
  recipients: { address: string; publicKey: string }[],
): Promise<SealedPayload> {
  if (recipients.length === 0) throw new Error("At least one recipient key is required");
  const messageKey = randomBytes(SECRETBOX_KEY_BYTES);
  const encryptedSubject = closeSecretbox(subject, messageKey);
  const encryptedBody = closeSecretbox(JSON.stringify(payload), messageKey);
  const wraps: Record<string, string> = {};
  for (const recipient of recipients) {
    const address = recipient.address.toLowerCase();
    if (wraps[address]) continue;
    wraps[address] = toBase64(sealToPublicKey(messageKey, recipient.publicKey));
  }
  messageKey.fill(0);
  return {
    encryptedSubject,
    encryptedBody,
    wraps,
    sizeBytes: encryptedSubject.length + encryptedBody.length,
  };
}

export async function decryptMessage<T = unknown>(
  encryptedSubject: string,
  encryptedBody: string,
  wrappedKey: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<{ subject: string; payload: T }> {
  const messageKey = unwrapMessageKey(wrappedKey, privateKeyB64, publicKeyB64);
  try {
    return {
      subject: openSecretbox(encryptedSubject, messageKey),
      payload: JSON.parse(openSecretbox(encryptedBody, messageKey)) as T,
    };
  } finally {
    messageKey.fill(0);
  }
}

export async function decryptSubject(
  encryptedSubject: string,
  wrappedKey: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<string> {
  const messageKey = unwrapMessageKey(wrappedKey, privateKeyB64, publicKeyB64);
  try {
    return openSecretbox(encryptedSubject, messageKey);
  } finally {
    messageKey.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export function generateAttachmentKey(): string {
  return toBase64(randomBytes(32));
}

export function encryptAttachmentBytes(
  data: Uint8Array,
  keyB64?: string,
): { ciphertext: Uint8Array; key: string } {
  const key = keyB64 ? fromBase64(keyB64) : randomBytes(32);
  if (key.length !== 32) throw new Error("Invalid attachment key");
  const nonce = randomBytes(XCHACHA_NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(data) as Uint8Array;
  const encoded = utf8(envelope(AEAD_PREFIX, nonce, ciphertext));
  return { ciphertext: encoded, key: toBase64(key) };
}

export function decryptAttachmentBytes(ciphertext: Uint8Array, keyB64: string): Uint8Array {
  const key = fromBase64(keyB64);
  const { nonce, ciphertext: body } = splitEnvelope(AEAD_PREFIX, text(ciphertext));
  return xchacha20poly1305(key, nonce).decrypt(body) as Uint8Array;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function sha256Hex(value: string): string {
  return Array.from(sha256(utf8(value)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function md5Hex(value: string): string {
  return Array.from(md5(utf8(value)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function publicKeyFingerprint(publicKeyB64: string): string {
  const digest = sha256(fromBase64(publicKeyB64));
  return Array.from(digest.slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(":");
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Generates the same 24-word BIP-39 kit that the web client creates. */
export async function generateRecoveryPhrase(): Promise<string> {
  const entropy = randomBytes(32);
  const checksum = sha256(entropy)[0];
  const bits: number[] = [];
  for (const byte of entropy) {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >> shift) & 1);
  }
  for (let shift = 7; shift >= 0; shift -= 1) bits.push((checksum >> shift) & 1);
  const words: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    let value = 0;
    for (let offset = 0; offset < 11; offset += 1) {
      value = (value << 1) | bits[index * 11 + offset];
    }
    words.push(wordlist[value]);
  }
  return words.join(" ");
}

export interface RecoveryKit {
  phrase: string;
  argonSalt: string;
  encryptedPrivateKey: string;
  recoveryKeyHash: string;
}

export async function createRecoveryKit(
  bundle: KeyBundle,
  onProgress?: (fraction: number) => void,
): Promise<RecoveryKit> {
  const phrase = await generateRecoveryPhrase();
  const argonSalt = toBase64(randomBytes(ARGON_SALT_BYTES));
  const key = await deriveKeyFromPassword(phrase, argonSalt, onProgress);
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const encryptedPrivateKey = envelope(
    SECRETBOX_PREFIX,
    nonce,
    secretbox(utf8(JSON.stringify(bundle)), key, nonce),
  );
  key.fill(0);
  return {
    phrase,
    argonSalt,
    encryptedPrivateKey,
    recoveryKeyHash: sha256Hex(phrase),
  };
}

export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
