import { beforeAll, describe, expect, it } from "vitest";
import {
  createKeyEnvelope,
  createRecoveryKit,
  decryptAttachmentBytes,
  decryptMessage,
  encryptAttachmentBytes,
  encryptMessageForPublicKey,
  encryptMessageForRecipients,
  generateAttachmentKey,
  generateBackupCodes,
  generateKeyBundle,
  hashBackupCode,
  normalizeBackupCode,
  ready,
  sha256Hex,
  unlockKeyBundle,
  unlockKeyBundleWithPhrase,
  unwrapMessageKey,
  wrapKeyForRecipient,
} from "../src";

const PASSWORD = "correct horse battery staple";

describe("NyxMail cryptography", () => {
  beforeAll(async () => {
    await ready();
  });

  it("round-trips an encrypted private key bundle", async () => {
    const bundle = await generateKeyBundle();
    const envelope = await createKeyEnvelope(bundle, PASSWORD);
    expect(envelope.encryptedPrivateKey).not.toContain(bundle.privateKey);
    const unlocked = await unlockKeyBundle(envelope.encryptedPrivateKey, envelope.argonSalt, PASSWORD);
    expect(unlocked).toEqual(bundle);
  });

  it("fails to unlock with the wrong password", async () => {
    const bundle = await generateKeyBundle();
    const envelope = await createKeyEnvelope(bundle, PASSWORD);
    await expect(
      unlockKeyBundle(envelope.encryptedPrivateKey, envelope.argonSalt, "not-the-password"),
    ).rejects.toThrow(/Incorrect password|recovery phrase/i);
  });

  it("unlocks with a 24-word recovery phrase", async () => {
    const bundle = await generateKeyBundle();
    const kit = await createRecoveryKit(bundle);
    expect(kit.phrase.split(" ")).toHaveLength(24);
    const unlocked = await unlockKeyBundleWithPhrase(
      kit.encryptedPrivateKey,
      kit.argonSalt,
      kit.phrase,
    );
    expect(unlocked.publicKey).toBe(bundle.publicKey);
    await expect(
      unlockKeyBundleWithPhrase(kit.encryptedPrivateKey, kit.argonSalt, "wrong words ".repeat(12).trim()),
    ).rejects.toThrow();
  });

  it("round-trips a message for two recipients", async () => {
    const alice = await generateKeyBundle();
    const bob = await generateKeyBundle();
    const sealed = await encryptMessageForRecipients(
      "Quarterly numbers",
      { html: "<p>Secret plans</p>", text: "Secret plans", attachments: [] },
      [
        { address: "alice@localhost", publicKey: alice.publicKey },
        { address: "bob@localhost", publicKey: bob.publicKey },
      ],
    );
    expect(sealed.wraps["alice@localhost"]).toBeTruthy();
    expect(sealed.wraps["bob@localhost"]).toBeTruthy();
    expect(sealed.encryptedBody).not.toContain("Secret plans");
    const opened = await decryptMessage<{ html: string }>(
      sealed.encryptedSubject,
      sealed.encryptedBody,
      sealed.wraps["bob@localhost"],
      bob.privateKey,
      bob.publicKey,
    );
    expect(opened.subject).toBe("Quarterly numbers");
    expect(opened.payload.html).toContain("Secret plans");
    await expect(
      decryptMessage(
        sealed.encryptedSubject,
        sealed.encryptedBody,
        sealed.wraps["alice@localhost"],
        bob.privateKey,
        bob.publicKey,
      ),
    ).rejects.toThrow();
  });

  it("server-sealed single-recipient payload decrypts client-side", async () => {
    const bundle = await generateKeyBundle();
    const sealed = await encryptMessageForPublicKey(
      "Inbound hello",
      { html: "<b>hello</b>", text: "hello", attachments: [] },
      bundle.publicKey,
    );
    const opened = await decryptMessage<{ text: string }>(
      sealed.encryptedSubject,
      sealed.encryptedBody,
      sealed.wrappedKey,
      bundle.privateKey,
      bundle.publicKey,
    );
    expect(opened.subject).toBe("Inbound hello");
    expect(opened.payload.text).toBe("hello");
  });

  it("wraps a raw message key for a recipient", async () => {
    const bundle = await generateKeyBundle();
    const key = new Uint8Array(32);
    key.fill(7);
    const wrapped = await wrapKeyForRecipient(key, bundle.publicKey);
    const unwrapped = await unwrapMessageKey(wrapped, bundle.privateKey, bundle.publicKey);
    expect(Array.from(unwrapped)).toEqual(Array.from(key));
  });

  it("encrypts and decrypts attachments", async () => {
    const content = new TextEncoder().encode("a private attachment");
    const encrypted = await encryptAttachmentBytes(content);
    expect(Buffer.from(encrypted.ciphertext).toString()).not.toContain("private attachment");
    const decrypted = await decryptAttachmentBytes(encrypted.ciphertext, encrypted.key);
    expect(Buffer.from(decrypted).toString()).toBe("a private attachment");
    await expect(
      decryptAttachmentBytes(encrypted.ciphertext, await generateAttachmentKey()),
    ).rejects.toThrow();
  });

  it("generates single-use backup code hashes", async () => {
    const codes = await generateBackupCodes(10);
    expect(codes.plain).toHaveLength(10);
    expect(new Set(codes.plain).size).toBe(10);
    expect(await hashBackupCode(normalizeBackupCode(codes.plain[0]))).toBe(codes.hashes[0]);
  });

  it("produces stable SHA-256 hashes", async () => {
    expect(await sha256Hex("nyxmail")).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex("nyxmail")).toBe(await sha256Hex("nyxmail"));
  });
});
