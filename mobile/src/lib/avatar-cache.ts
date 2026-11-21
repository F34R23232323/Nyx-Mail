import * as FileSystem from "expo-file-system/legacy";
import { ApiError, apiFetchBytes } from "./api";
import { md5Hex, toBase64 } from "./crypto";

/**
 * Sender avatars are proxied by the existing authenticated NyxMail endpoint.
 * React Native's Image component cannot read the httpOnly session cookie, so we
 * fetch the bytes through the API client and keep a small persistent disk cache.
 */
const memory = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const MAX_MEMORY_ENTRIES = 320;

function directory(): string {
  return `${FileSystem.cacheDirectory}nyxmail-avatars/`;
}

function pruneMemory(): void {
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (!oldest) break;
    memory.delete(oldest);
  }
}

function emailHash(email: string): { hash: string; domain: string } | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  return {
    hash: md5Hex(normalized),
    domain: normalized.split("@").pop() ?? "",
  };
}

export async function loadAvatarUri(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const identity = emailHash(email);
  if (!identity) return null;
  const { hash, domain } = identity;
  if (memory.has(hash)) return memory.get(hash) ?? null;
  const pending = inflight.get(hash);
  if (pending) return pending;

  const request = (async (): Promise<string | null> => {
    const file = `${directory()}${hash}`;
    const typeFile = `${file}.type`;
    try {
      const info = await FileSystem.getInfoAsync(file);
      if (info.exists) {
        const base64 = await FileSystem.readAsStringAsync(file, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (base64) {
          const type =
            (await FileSystem.readAsStringAsync(typeFile).catch(() => "")) || "image/jpeg";
          const uri = `data:${type};base64,${base64}`;
          memory.set(hash, uri);
          return uri;
        }
      }
    } catch {
      // fall through to the network
    }

    try {
      const response = await apiFetchBytes(
        `/api/v1/avatars/${hash}?domain=${encodeURIComponent(domain)}`,
        { timeoutMs: 12_000 },
      );
      if (!response.bytes.length) {
        memory.set(hash, null);
        return null;
      }
      const base64 = toBase64(response.bytes);
      const uri = `data:${response.contentType || "image/jpeg"};base64,${base64}`;
      memory.set(hash, uri);
      pruneMemory();
      try {
        await FileSystem.makeDirectoryAsync(directory(), { intermediates: true });
        await Promise.all([
          FileSystem.writeAsStringAsync(file, base64, {
            encoding: FileSystem.EncodingType.Base64,
          }),
          FileSystem.writeAsStringAsync(typeFile, response.contentType || "image/jpeg"),
        ]);
      } catch {
        // cache failure must never break avatar rendering
      }
      return uri;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Most addresses have no Gravatar. Remember that for this session.
        memory.set(hash, null);
        return null;
      }
      throw error;
    }
  })();

  inflight.set(hash, request);
  try {
    return await request;
  } finally {
    inflight.delete(hash);
  }
}
