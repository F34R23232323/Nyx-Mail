import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { labelCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { labelToDTO } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const labels = await prisma.label.findMany({ where: { userId: auth.userId }, orderBy: { name: "asc" } });
    return json({ labels: labels.map(labelToDTO) });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, labelCreateSchema);
    const count = await prisma.label.count({ where: { userId: auth.userId } });
    if (count >= 100) throw new ApiError(400, "Label limit reached", "label_limit");
    const existing = await prisma.label.findFirst({
      where: { userId: auth.userId, name: body.name },
      select: { id: true },
    });
    if (existing) throw new ApiError(409, "A label with that name already exists", "label_exists");
    const label = await prisma.label.create({
      data: { userId: auth.userId, name: body.name, color: body.color },
    });
    return json({ label: labelToDTO(label) }, { status: 201 });
  });
}
