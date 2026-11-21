/**
 * Cross-checks the mobile pure-JS crypto against libsodium (the web client).
 * Run with: cd mobile && npm run test:crypto
 */
import sodium from "libsodium-wrappers-sumo";
import {
  deriveKeyFromPassword,
  decryptKeyBundle,
  decryptMessage,
  encryptMessageForRecipients,
  decryptAttachmentBytes,
  encryptAttachmentBytes,
  toBase64,
  unwrapMessageKey,
} from "../src/lib/crypto";

function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}
function unb64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}
function assert(condition: unknown, label: string): void {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok ${label}`);
}

function split(value: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const parts = value.split(".");
  return { nonce: unb64(parts[1]), ciphertext: unb64(parts[2]) };
}

async function main(): Promise<void> {
  await sodium.ready;
  console.log("mobile <-> libsodium compatibility");

  const password = "Correct horse battery staple!7";
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const sodiumKey = sodium.crypto_pwhash(
    32,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const mobileKey = await deriveKeyFromPassword(password, b64(salt));
  assert(b64(sodiumKey) === b64(mobileKey), "Argon2id matches libsodium");

  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  const bundle = {
    version: 1 as const,
    publicKey: b64(box.publicKey),
    privateKey: b64(box.privateKey),
    signingPublicKey: b64(sign.publicKey),
    signingPrivateKey: b64(sign.privateKey),
  };

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const sodiumEnvelope = `nyx1.${b64(nonce)}.${b64(
    sodium.crypto_secretbox_easy(sodium.from_string(JSON.stringify(bundle)), nonce, sodiumKey),
  )}`;
  const unlocked = await decryptKeyBundle(sodiumEnvelope, mobileKey);
  assert(unlocked.publicKey === bundle.publicKey, "mobile decrypts libsodium key envelope");

  const { createKeyEnvelope } = await import("../src/lib/crypto");
  const ours = await createKeyEnvelope(bundle, password);
  const oursKey = await deriveKeyFromPassword(password, ours.argonSalt);
  const ourEnvelope = split(ours.encryptedPrivateKey);
  const opened = sodium.crypto_secretbox_open_easy(ourEnvelope.ciphertext, ourEnvelope.nonce, oursKey);
  assert(opened && sodium.to_string(opened) === JSON.stringify(bundle), "libsodium decrypts mobile key envelope");

  const messageKey = sodium.randombytes_buf(32);
  const sealed = sodium.crypto_box_seal(messageKey, box.publicKey);
  const openedKey = unwrapMessageKey(b64(sealed), bundle.privateKey, bundle.publicKey);
  assert(b64(openedKey) === b64(messageKey), "mobile opens crypto_box_seal");

  const recipientKeypair = sodium.crypto_box_keypair();
  const mobileMessage = await encryptMessageForRecipients(
    "Hello from mobile",
    { html: "<p>Hi</p>", text: "Hi", attachments: [] },
    [{ address: "rcpt@example.com", publicKey: b64(recipientKeypair.publicKey) }],
  );
  const recipientKey = sodium.crypto_box_seal_open(
    unb64(mobileMessage.wraps["rcpt@example.com"]),
    recipientKeypair.publicKey,
    recipientKeypair.privateKey,
  );
  assert(recipientKey?.length === 32, "libsodium opens mobile sealed message key");

  const subjectEnvelope = split(mobileMessage.encryptedSubject);
  const sodiumSubject = sodium.crypto_secretbox_open_easy(
    subjectEnvelope.ciphertext,
    subjectEnvelope.nonce,
    recipientKey,
  );
  assert(sodium.to_string(sodiumSubject) === "Hello from mobile", "libsodium decrypts mobile subject");

  const bodyEnvelope = split(mobileMessage.encryptedBody);
  const sodiumBody = sodium.crypto_secretbox_open_easy(
    bodyEnvelope.ciphertext,
    bodyEnvelope.nonce,
    recipientKey,
  );
  assert(
    JSON.parse(sodium.to_string(sodiumBody)).html === "<p>Hi</p>",
    "libsodium decrypts mobile body",
  );

  const decoded = await decryptMessage(
    mobileMessage.encryptedSubject,
    mobileMessage.encryptedBody,
    mobileMessage.wraps["rcpt@example.com"],
    b64(recipientKeypair.privateKey),
    b64(recipientKeypair.publicKey),
  );
  assert(decoded.subject === "Hello from mobile", "mobile decrypts its own message");

  const payload = sodium.randombytes_buf(4096);
  const encrypted = encryptAttachmentBytes(payload);
  const attachmentEnvelope = split(new TextDecoder().decode(encrypted.ciphertext));
  const decryptedBySodium = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    attachmentEnvelope.ciphertext,
    null,
    attachmentEnvelope.nonce,
    unb64(encrypted.key),
  );
  assert(decryptedBySodium && b64(decryptedBySodium) === b64(payload), "libsodium decrypts mobile attachment");

  const sodiumNonce = sodium.randombytes_buf(24);
  const sodiumCt = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    null,
    null,
    sodiumNonce,
    unb64(encrypted.key),
  );
  const sodiumAttachment = new TextEncoder().encode(`nyxatt1.${b64(sodiumNonce)}.${b64(sodiumCt)}`);
  const mobilePlain = decryptAttachmentBytes(sodiumAttachment, encrypted.key);
  assert(b64(mobilePlain) === b64(payload), "mobile decrypts libsodium attachment");

  const { generateRecoveryPhrase, sha256Hex } = await import("../src/lib/crypto");
  const phrase = await generateRecoveryPhrase();
  assert(phrase.split(" ").length === 24, "generates a 24-word recovery phrase");
  assert(sha256Hex("abc").length === 64, "sha256 hex output");

  console.log("all compatibility checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
