import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { createDomainDkimKey, loadDomainSettings } from "@nyxmail/server";
import { requireAuth } from "@/lib/auth";
import { isInstanceAdmin, requireInstanceAdmin } from "@/lib/admin";
import { domainToDTO, normalizeCatchAllAddress } from "@/lib/domains";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { domainCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const [settings, canManage] = await Promise.all([
      loadDomainSettings(),
      isInstanceAdmin(auth.userId),
    ]);
    return json({
      primaryDomain: settings.primary,
      domains: settings.domains.map((domain) => domain.domain),
      signupDomains: settings.signupDomains,
      catchAllDomains: Object.keys(settings.catchAll),
      canManage,
      entries: settings.domains.map(domainToDTO),
    });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    await requireInstanceAdmin(auth.userId);
    const body = await parseBody(request, domainCreateSchema);
    const domain = body.domain;

    const existing = await prisma.mailDomain.findUnique({
      where: { domain },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, "That domain has already been added", "domain_exists");
    }

    const catchAllAddress = await normalizeCatchAllAddress(body.catchAllAddress);
    const dkim = body.generateDkim ? createDomainDkimKey() : null;
    const created = await prisma.mailDomain.create({
      data: {
        domain,
        allowSignup: body.allowSignup,
        catchAllAddress,
        dkimSelector: dkim?.selector ?? null,
        dkimPublicKey: dkim?.publicKey ?? null,
        dkimPrivateKey: dkim?.privateKeyEncrypted ?? null,
      },
    });

    const settings = await loadDomainSettings();
    const entry = settings.domains.find((item) => item.domain === domain);
    if (!entry) throw new ApiError(500, "The domain could not be loaded", "domain_error");
    return json(
      {
        domain: domainToDTO(entry),
        dkimGenerated: Boolean(dkim),
        managedId: created.id,
      },
      { status: 201 },
    );
  });
}
