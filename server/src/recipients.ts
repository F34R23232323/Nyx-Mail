import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { catchAllHostedTargetForAddress } from "./domains";

export interface LocalRecipient {
  userId: string;
  primaryEmail: string;
  displayName: string;
  publicKey: string;
  matchedAddress: string;
  isAlias: boolean;
  /** True when matchedAddress was delivered via a domain catch-all rule. */
  catchAll?: boolean;
  /** The mailbox or alias the catch-all delivered to (the target address). */
  catchAllTarget?: string;
}

async function findExactLocalRecipient(address: string): Promise<LocalRecipient | null> {
  const normalized = normalizeEmail(address);
  if (!normalized) return null;

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, displayName: true, publicKey: true },
  });
  if (user) {
    return {
      userId: user.id,
      primaryEmail: user.email,
      displayName: user.displayName,
      publicKey: user.publicKey,
      matchedAddress: normalized,
      isAlias: false,
    };
  }

  const alias = await prisma.alias.findUnique({
    where: { address: normalized },
    include: {
      user: { select: { id: true, email: true, displayName: true, publicKey: true } },
    },
  });
  if (alias?.active) {
    return {
      userId: alias.user.id,
      primaryEmail: alias.user.email,
      displayName: alias.user.displayName,
      publicKey: alias.user.publicKey,
      matchedAddress: normalized,
      isAlias: true,
    };
  }
  return null;
}

/**
 * Resolve an address to a hosted mailbox.
 *
 * Exact users and aliases always win. If no mailbox or alias exists, a
 * per-domain catch-all configured in Settings → Domains (or the legacy
 * CATCH_ALL_MAP / CATCH_ALL_DOMAIN environment variables) routes the message
 * to the configured local mailbox. The catch-all target must itself be an
 * existing local user or alias; chained catch-alls are intentionally not
 * resolved.
 */
export async function findLocalRecipient(address: string): Promise<LocalRecipient | null> {
  const normalized = normalizeEmail(address);
  if (!normalized) return null;

  const exact = await findExactLocalRecipient(normalized);
  if (exact) return exact;

  const target = await catchAllHostedTargetForAddress(normalized);
  if (!target || target === normalized) return null;

  const catchAllRecipient = await findExactLocalRecipient(target);
  if (!catchAllRecipient) return null;

  return {
    ...catchAllRecipient,
    matchedAddress: normalized,
    isAlias: true,
    catchAll: true,
    catchAllTarget: normalizeEmail(target),
  };
}

export async function getUserAddresses(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, aliases: { where: { active: true }, select: { address: true } } },
  });
  if (!user) return [];
  return [user.email, ...user.aliases.map((alias) => alias.address)].map(normalizeEmail);
}

export async function isOwnAddress(userId: string, address: string): Promise<boolean> {
  const addresses = await getUserAddresses(userId);
  return addresses.includes(normalizeEmail(address));
}
