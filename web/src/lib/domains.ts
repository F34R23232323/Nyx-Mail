import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import type { HostedDomainConfig } from "@nyxmail/server";
import { ApiError } from "./http";

export interface DomainDTO {
  domain: string;
  isPrimary: boolean;
  allowSignup: boolean;
  catchAllAddress: string | null;
  dkimConfigured: boolean;
  dkimSelector: string | null;
  fromEnvironment: boolean;
  managed: boolean;
  canRemove: boolean;
}

export function domainToDTO(domain: HostedDomainConfig): DomainDTO {
  return {
    domain: domain.domain,
    isPrimary: domain.isPrimary,
    allowSignup: domain.allowSignup,
    catchAllAddress: domain.catchAllAddress,
    dkimConfigured: Boolean(domain.dkimPublicKey),
    dkimSelector: domain.dkimSelector,
    fromEnvironment: domain.fromEnvironment,
    managed: domain.managed,
    canRemove: domain.managed && !domain.fromEnvironment,
  };
}

/** Catch-all targets must be a real mailbox or alias on this instance. */
export async function normalizeCatchAllAddress(value: string | null | undefined): Promise<string | null> {
  if (value === undefined || value === null || !value.trim()) return null;
  const normalized = normalizeEmail(value);
  if (!normalized) {
    throw new ApiError(400, "Enter a valid catch-all address", "invalid_catch_all");
  }
  const [user, alias] = await Promise.all([
    prisma.user.findUnique({ where: { email: normalized }, select: { id: true } }),
    prisma.alias.findUnique({ where: { address: normalized }, select: { id: true, active: true } }),
  ]);
  if (!user && !alias?.active) {
    throw new ApiError(
      400,
      "The catch-all target must be an existing mailbox or active alias on this server",
      "invalid_catch_all",
    );
  }
  return normalized;
}
