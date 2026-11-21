import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { domainOf, normalizeEmail } from "@nyxmail/shared";
import { hostedDomains } from "@nyxmail/server";
import { aliasCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { aliasToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const aliases = await prisma.alias.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "asc" },
    });
    return json({ aliases: aliases.map(aliasToDTO) });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, aliasCreateSchema);
    const address = normalizeEmail(body.address);
    const allowedDomains = await hostedDomains();
    if (!allowedDomains.includes(domainOf(address))) {
      throw new ApiError(
        400,
        `Aliases must use one of: ${allowedDomains.map((domain) => `@${domain}`).join(", ")}`,
        "domain_restricted",
      );
    }
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { email: true, _count: { select: { aliases: true } } },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    if (user.email === address) throw new ApiError(409, "That is your primary address", "address_taken");
    if (user._count.aliases >= 10) throw new ApiError(400, "You can have at most 10 aliases", "alias_limit");
    const [existingAlias, existingUser] = await Promise.all([
      prisma.alias.findUnique({ where: { address }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: address }, select: { id: true } }),
    ]);
    if (existingAlias || existingUser) throw new ApiError(409, "That address is already in use", "address_taken");
    const alias = await prisma.alias.create({ data: { userId: auth.userId, address } });
    return json({ alias: aliasToDTO(alias) }, { status: 201 });
  });
}
