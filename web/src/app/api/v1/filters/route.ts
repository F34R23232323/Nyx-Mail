import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { normalizeEmail } from "@nyxmail/shared";
import { filterSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePattern(pattern: string): string {
  const value = pattern.trim().toLowerCase();
  if (value.startsWith("@")) return `@${normalizeEmail(`x${value}`).slice(1)}`;
  return normalizeEmail(value);
}

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const filters = await prisma.mailFilter.findMany({
      where: { userId: auth.userId },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
    });
    return json({
      filters: filters.map((filter) => ({
        id: filter.id,
        kind: filter.kind,
        pattern: filter.pattern,
        createdAt: filter.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, filterSchema);
    const pattern = normalizePattern(body.pattern);
    if (!pattern || (pattern.includes("@") && !/^@?[^@\s]+@?[^@\s]*$/.test(pattern))) {
      throw new ApiError(400, "Invalid filter pattern", "invalid_pattern");
    }
    const count = await prisma.mailFilter.count({ where: { userId: auth.userId } });
    if (count >= 500) throw new ApiError(400, "Filter limit reached", "filter_limit");
    const filter = await prisma.mailFilter.upsert({
      where: { userId_kind_pattern: { userId: auth.userId, kind: body.kind, pattern } },
      create: { userId: auth.userId, kind: body.kind, pattern },
      update: {},
    });
    return json({
      filter: {
        id: filter.id,
        kind: filter.kind,
        pattern: filter.pattern,
        createdAt: filter.createdAt.toISOString(),
      },
    }, { status: 201 });
  });
}
