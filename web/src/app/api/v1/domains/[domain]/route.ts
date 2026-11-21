import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { normalizeDomain } from "@nyxmail/shared/domains";
import { createDomainDkimKey, environmentDomainSettings } from "@nyxmail/server";
import { requireAuth } from "@/lib/auth";
import { requireInstanceAdmin } from "@/lib/admin";
import { normalizeCatchAllAddress } from "@/lib/domains";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { domainUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function environmentDomain(domain: string) {
  return environmentDomainSettings().domains.find((item) => item.domain === domain);
}

export async function PATCH(request: NextRequest, context: { params: { domain: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await requireInstanceAdmin(auth.userId);
    const domain = normalizeDomain(context.params.domain);
    const body = await parseBody(request, domainUpdateSchema);

    const envDomain = environmentDomain(domain);
    const existing = await prisma.mailDomain.findUnique({ where: { domain }, select: { id: true } });
    if (!existing && !envDomain) {
      throw new ApiError(404, "Domain not found", "not_found");
    }
    if (body.enabled === false && envDomain) {
      throw new ApiError(
        409,
        "This domain is still listed in MAIL_DOMAINS or CATCH_ALL_MAP. Remove it from the environment before disabling it here.",
        "environment_domain",
      );
    }

    const catchAllAddress =
      body.catchAllAddress === undefined
        ? undefined
        : await normalizeCatchAllAddress(body.catchAllAddress);
    const dkim = body.regenerateDkim ? createDomainDkimKey() : null;

    if (existing) {
      await prisma.mailDomain.update({
        where: { id: existing.id },
        data: {
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          ...(body.allowSignup === undefined ? {} : { allowSignup: body.allowSignup }),
          ...(catchAllAddress === undefined ? {} : { catchAllAddress }),
          ...(dkim
            ? {
                dkimSelector: dkim.selector,
                dkimPublicKey: dkim.publicKey,
                dkimPrivateKey: dkim.privateKeyEncrypted,
              }
            : {}),
        },
      });
    } else {
      // Promote an environment-only domain into an editable record without
      // removing the environment bootstrap.
      await prisma.mailDomain.create({
        data: {
          domain,
          allowSignup: body.allowSignup ?? false,
          catchAllAddress: catchAllAddress ?? null,
          dkimSelector: dkim?.selector ?? null,
          dkimPublicKey: dkim?.publicKey ?? null,
          dkimPrivateKey: dkim?.privateKeyEncrypted ?? null,
        },
      });
    }

    return json({ ok: true, dkimRotated: Boolean(dkim) });
  });
}

export async function DELETE(request: NextRequest, context: { params: { domain: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await requireInstanceAdmin(auth.userId);
    const domain = normalizeDomain(context.params.domain);

    const row = await prisma.mailDomain.findUnique({ where: { domain }, select: { id: true } });
    if (!row) throw new ApiError(404, "Domain not found", "not_found");
    if (environmentDomain(domain)) {
      throw new ApiError(
        409,
        "This domain is still listed in MAIL_DOMAINS or CATCH_ALL_MAP. Remove it from the environment, then delete it here.",
        "environment_domain",
      );
    }

    await prisma.mailDomain.delete({ where: { id: row.id } });
    return json({ ok: true });
  });
}
