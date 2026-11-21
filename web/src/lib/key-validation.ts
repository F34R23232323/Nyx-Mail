export function isEncryptedKeyEnvelope(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 3 &&
    parts[0] === "nyx1" &&
    Boolean(parts[1] && parts[1].length >= 16) &&
    Boolean(parts[2] && parts[2].length > 20)
  );
}

export function isArgonSalt(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 16;
  } catch {
    return false;
  }
}

export function isPublicKey(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}
