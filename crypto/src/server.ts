/**
 * Server-side sealing helpers.
 *
 * The server is allowed to *create* ciphertext for inbound mail using the
 * recipient's public key (exactly like a PGP keyserver encrypting to a user).
 * It cannot decrypt mailbox content because it never has an unencrypted
 * private key. These helpers are shared by the ingest webhook and importers.
 */
import {
  decryptAttachmentBytes,
  encryptAttachmentBytes,
  encryptMessageForPublicKey,
  ready,
  sealAttachmentKey,
} from "./index";

export async function sealInboundMessage<T>(
  subject: string,
  payload: T,
  recipientPublicKey: string,
): Promise<{ encryptedSubject: string; encryptedBody: string; wrappedKey: string; sizeBytes: number }> {
  await ready();
  return encryptMessageForPublicKey(subject, payload, recipientPublicKey);
}

export async function encryptInboundAttachment(
  data: Uint8Array,
  ownerPublicKey: string,
): Promise<{ ciphertext: Uint8Array; key: string; sealedKey: string }> {
  const encrypted = await encryptAttachmentBytes(data);
  const sealedKey = await sealAttachmentKey(encrypted.key, ownerPublicKey);
  return { ciphertext: encrypted.ciphertext, key: encrypted.key, sealedKey };
}

export async function decryptRelayAttachment(
  ciphertext: Uint8Array,
  key: string,
): Promise<Uint8Array> {
  return decryptAttachmentBytes(ciphertext, key);
}

export { ready };
