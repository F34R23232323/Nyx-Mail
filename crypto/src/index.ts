/**
 * NyxMail client cryptography.
 *
 * Security model:
 *  - X25519 key agreement + XSalsa20-Poly1305 sealed boxes wrap a random
 *    256-bit message key. The sealed message key is the only per-recipient
 *    value the server stores.
 *  - The message key encrypts subject and body with XSalsa20-Poly1305
 *    (secretbox). Attachments use independent XChaCha20-Poly1305 keys which
 *    live only inside the encrypted body.
 *  - The private key bundle is encrypted with a 256-bit key derived from the
 *    account password using Argon2id. The server stores only the ciphertext.
 *  - A 24-word BIP-39 recovery phrase derives an independent Argon2id key
 *    which encrypts the same private bundle.
 */
import sodium from "libsodium-wrappers-sumo";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

export const KDF_PARAMS = {
  opsLimit: 3,
  memLimit: 64 * 1024 * 1024,
  algorithm: "Argon2id",
} as const;

const SECRETBOX_PREFIX = "nyx1";
const AEAD_PREFIX = "nyxatt1";

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

export interface RecoveryKit extends KeyEnvelope {
  phrase: string;
  recoveryKeyHash: string;
}

export interface SealedPayload {
  encryptedSubject: string;
  encryptedBody: string;
  wraps: Record<string, string>;
  sizeBytes: number;
}

export interface SealedForOne {
  encryptedSubject: string;
  encryptedBody: string;
  wrappedKey: string;
  sizeBytes: number;
}

export interface DecryptedMessage<T = unknown> {
  subject: string;
  payload: T;
}

export interface EncryptedAttachment {
  ciphertext: Uint8Array;
  key: string;
}

export interface BackupCodeSet {
  plain: string[];
  hashes: string[];
}

let readyPromise: Promise<void> | null = null;

export async function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = sodium.ready;
  }
  await readyPromise;
}

function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function fromB64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}

function concatVersion(prefix: string, nonce: Uint8Array, ciphertext: Uint8Array): string {
  return `${prefix}.${b64(nonce)}.${b64(ciphertext)}`;
}

function splitVersion(prefix: string, value: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) {
    throw new Error("Corrupted encrypted value");
  }
  return { nonce: fromB64(parts[1]), ciphertext: fromB64(parts[2]) };
}

function utf8(value: string): Uint8Array {
  return sodium.from_string(value);
}

function text(bytes: Uint8Array): string {
  return sodium.to_string(bytes);
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function deriveKeyFromPassword(password: string, argonSaltB64: string): Promise<Uint8Array> {
  await ready();
  if (!password) throw new Error("Password is required");
  const salt = fromB64(argonSaltB64);
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES) {
    throw new Error("Invalid Argon2 salt");
  }
  return sodium.crypto_pwhash(
    32,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function deriveKeyFromPhrase(phrase: string, argonSaltB64: string): Promise<Uint8Array> {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid recovery phrase");
  }
  return deriveKeyFromPassword(normalized, argonSaltB64);
}

export function generateSalt(): string {
  // Sodium is initialized synchronously enough for randombytes after ready();
  // every public entry point awaits ready() before using this.
  return b64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES));
}

export async function generateKeyBundle(): Promise<KeyBundle> {
  await ready();
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    version: 1,
    publicKey: b64(box.publicKey),
    privateKey: b64(box.privateKey),
    signingPublicKey: b64(sign.publicKey),
    signingPrivateKey: b64(sign.privateKey),
  };
}

export function assertKeyBundle(bundle: unknown): asserts bundle is KeyBundle {
  if (!bundle || typeof bundle !== "object") throw new Error("Invalid key bundle");
  const b = bundle as Partial<KeyBundle>;
  if (
    b.version !== 1 ||
    typeof b.publicKey !== "string" ||
    typeof b.privateKey !== "string" ||
    typeof b.signingPublicKey !== "string" ||
    typeof b.signingPrivateKey !== "string"
  ) {
    throw new Error("Invalid key bundle");
  }
}

export async function encryptKeyBundle(bundle: KeyBundle, key: Uint8Array): Promise<string> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(utf8(JSON.stringify(bundle)), nonce, key);
  return concatVersion(SECRETBOX_PREFIX, nonce, ciphertext);
}

export async function decryptKeyBundle(encrypted: string, key: Uint8Array): Promise<KeyBundle> {
  await ready();
  try {
    const { nonce, ciphertext } = splitVersion(SECRETBOX_PREFIX, encrypted);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    if (!plaintext) throw new Error("bad key");
    const parsed: unknown = JSON.parse(text(plaintext));
    assertKeyBundle(parsed);
    return parsed;
  } catch {
    throw new Error("Incorrect password or recovery phrase");
  }
}

export async function createKeyEnvelope(bundle: KeyBundle, password: string): Promise<KeyEnvelope> {
  await ready();
  const argonSalt = generateSalt();
  const key = await deriveKeyFromPassword(password, argonSalt);
  const encryptedPrivateKey = await encryptKeyBundle(bundle, key);
  sodium.memzero(key);
  return { argonSalt, encryptedPrivateKey };
}

export async function createRecoveryKit(bundle: KeyBundle): Promise<RecoveryKit> {
  await ready();
  const phrase = normalizeRecoveryPhrase(generateMnemonic(wordlist, 256));
  const argonSalt = generateSalt();
  const key = await deriveKeyFromPhrase(phrase, argonSalt);
  const encryptedPrivateKey = await encryptKeyBundle(bundle, key);
  sodium.memzero(key);
  return {
    phrase,
    argonSalt,
    encryptedPrivateKey,
    recoveryKeyHash: await sha256Hex(phrase),
  };
}

export async function unlockKeyBundle(
  encryptedPrivateKey: string,
  argonSalt: string,
  password: string,
): Promise<KeyBundle> {
  const key = await deriveKeyFromPassword(password, argonSalt);
  try {
    return await decryptKeyBundle(encryptedPrivateKey, key);
  } finally {
    sodium.memzero(key);
  }
}

export async function unlockKeyBundleWithPhrase(
  encryptedPrivateKey: string,
  argonSalt: string,
  phrase: string,
): Promise<KeyBundle> {
  const key = await deriveKeyFromPhrase(phrase, argonSalt);
  try {
    return await decryptKeyBundle(encryptedPrivateKey, key);
  } finally {
    sodium.memzero(key);
  }
}

export async function sha256Hex(value: string): Promise<string> {
  await ready();
  return sodium.to_hex(sodium.crypto_hash_sha256(utf8(value)));
}

export async function wrapKeyForRecipient(messageKey: Uint8Array, recipientPublicKey: string): Promise<string> {
  await ready();
  const sealed = sodium.crypto_box_seal(messageKey, fromB64(recipientPublicKey));
  return b64(sealed);
}

export async function unwrapMessageKey(wrappedKey: string, privateKeyB64: string, publicKeyB64: string): Promise<Uint8Array> {
  await ready();
  try {
    const opened = sodium.crypto_box_seal_open(
      fromB64(wrappedKey),
      fromB64(publicKeyB64),
      fromB64(privateKeyB64),
    );
    if (!opened || opened.length !== sodium.crypto_secretbox_KEYBYTES) {
      throw new Error("bad key");
    }
    return opened;
  } catch {
    throw new Error("This message was not encrypted for this key");
  }
}

function encryptSecretBox(plaintext: string, key: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  return concatVersion(SECRETBOX_PREFIX, nonce, sodium.crypto_secretbox_easy(utf8(plaintext), nonce, key));
}

function decryptSecretBox(value: string, key: Uint8Array): string {
  try {
    const { nonce, ciphertext } = splitVersion(SECRETBOX_PREFIX, value);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    if (!plaintext) throw new Error("bad ciphertext");
    return text(plaintext);
  } catch {
    throw new Error("Unable to decrypt message");
  }
}

export async function encryptMessageForRecipients<T>(
  subject: string,
  payload: T,
  recipients: Array<{ address: string; publicKey: string }>,
): Promise<SealedPayload> {
  await ready();
  if (recipients.length === 0) throw new Error("At least one recipient key is required");
  const messageKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const encryptedSubject = encryptSecretBox(subject, messageKey);
  const encryptedBody = encryptSecretBox(JSON.stringify(payload), messageKey);
  const wraps: Record<string, string> = {};
  for (const recipient of recipients) {
    const key = recipient.address.toLowerCase();
    if (wraps[key]) continue;
    wraps[key] = await wrapKeyForRecipient(messageKey, recipient.publicKey);
  }
  sodium.memzero(messageKey);
  return {
    encryptedSubject,
    encryptedBody,
    wraps,
    sizeBytes: encryptedSubject.length + encryptedBody.length,
  };
}

export async function encryptMessageForPublicKey<T>(
  subject: string,
  payload: T,
  publicKey: string,
): Promise<SealedForOne> {
  const sealed = await encryptMessageForRecipients(subject, payload, [
    { address: "owner", publicKey },
  ]);
  return {
    encryptedSubject: sealed.encryptedSubject,
    encryptedBody: sealed.encryptedBody,
    wrappedKey: sealed.wraps.owner,
    sizeBytes: sealed.sizeBytes,
  };
}

export async function decryptMessage<T = unknown>(
  encryptedSubject: string,
  encryptedBody: string,
  wrappedKey: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<DecryptedMessage<T>> {
  await ready();
  const messageKey = await unwrapMessageKey(wrappedKey, privateKeyB64, publicKeyB64);
  try {
    return {
      subject: decryptSecretBox(encryptedSubject, messageKey),
      payload: JSON.parse(decryptSecretBox(encryptedBody, messageKey)) as T,
    };
  } finally {
    sodium.memzero(messageKey);
  }
}

export async function decryptSubject(
  encryptedSubject: string,
  wrappedKey: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<string> {
  const messageKey = await unwrapMessageKey(wrappedKey, privateKeyB64, publicKeyB64);
  try {
    return decryptSecretBox(encryptedSubject, messageKey);
  } finally {
    sodium.memzero(messageKey);
  }
}

export async function generateAttachmentKey(): Promise<string> {
  await ready();
  return b64(sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES));
}

export async function encryptAttachmentBytes(
  data: Uint8Array,
  keyB64?: string,
): Promise<EncryptedAttachment> {
  await ready();
  const key = keyB64 ? fromB64(keyB64) : sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  if (key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error("Invalid attachment key");
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    data,
    null,
    null,
    nonce,
    key,
  );
  const payload = sodium.from_string(concatVersion(AEAD_PREFIX, nonce, ciphertext));
  return { ciphertext: payload, key: b64(key) };
}

export async function decryptAttachmentBytes(ciphertext: Uint8Array, keyB64: string): Promise<Uint8Array> {
  await ready();
  const key = fromB64(keyB64);
  let parsed: { nonce: Uint8Array; ciphertext: Uint8Array };
  try {
    parsed = splitVersion(AEAD_PREFIX, sodium.to_string(ciphertext));
  } catch {
    throw new Error("Corrupted attachment");
  }
  try {
    const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      parsed.ciphertext,
      null,
      parsed.nonce,
      key,
    );
    if (!plain) throw new Error("bad attachment");
    return plain;
  } catch {
    throw new Error("Unable to decrypt attachment");
  }
}

export async function sealAttachmentKey(attachmentKeyB64: string, publicKeyB64: string): Promise<string> {
  await ready();
  return b64(
    sodium.crypto_box_seal(fromB64(attachmentKeyB64), fromB64(publicKeyB64)),
  );
}

export async function openAttachmentKey(
  sealedKeyB64: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<string> {
  await ready();
  try {
    const opened = sodium.crypto_box_seal_open(
      fromB64(sealedKeyB64),
      fromB64(publicKeyB64),
      fromB64(privateKeyB64),
    );
    if (!opened) throw new Error("bad key");
    return b64(opened);
  } catch {
    throw new Error("Unable to unlock attachment key");
  }
}

export async function generateRecoveryPhrase(): Promise<string> {
  await ready();
  return normalizeRecoveryPhrase(generateMnemonic(wordlist, 256));
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalizeRecoveryPhrase(phrase), wordlist);
}

export async function publicKeyFingerprint(publicKeyB64: string): Promise<string> {
  await ready();
  return sodium
    .to_hex(sodium.crypto_hash_sha256(fromB64(publicKeyB64)))
    .slice(0, 32)
    .match(/.{1,4}/g)!
    .join(":")
    .toUpperCase();
}

export async function generateBackupCodes(count = 10): Promise<BackupCodeSet> {
  await ready();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = sodium.randombytes_buf(count * 8);
  const plain: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let code = "";
    for (let j = 0; j < 8; j += 1) {
      code += alphabet[random[i * 8 + j] % alphabet.length];
    }
    plain.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  const hashes = await Promise.all(
    plain.map(async (code) => sha256Hex(normalizeBackupCode(code))),
  );
  return { plain, hashes };
}

export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function hashBackupCode(code: string): Promise<string> {
  return sha256Hex(normalizeBackupCode(code));
}

export function randomBase64Url(bytes = 32): string {
  return sodium.to_base64(
    sodium.randombytes_buf(bytes),
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );
}
