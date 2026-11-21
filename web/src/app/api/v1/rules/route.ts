import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { mailRuleCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { mailRuleToDTO } from "@/lib/serializers";
import { compileRuleForUser } from "@/lib/rule-compile";
import { validateRuleResources } from "@/lib/rule-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safe(async () => {
    const auth = await requireAuth();
    const rules = await prisma.mailRule.findMany({
      where: { userId: auth.userId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return json({ rules: rules.map(mailRuleToDTO) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, mailRuleCreateSchema);
    const count = await prisma.mailRule.count({ where: { userId: auth.userId } });
    if (count >= 100) throw new ApiError(400, "Rule limit reached", "rule_limit");
    const compiled = await compileRuleForUser(auth.userId, {
      mode: body.mode,
      sieveScript: body.sieveScript,
      matchType: body.matchType,
      conditions: body.conditions,
      actions: body.actions,
      stopProcessing: body.stopProcessing,
    });
    await validateRuleResources(auth.userId, compiled.actions);
    const last = await prisma.mailRule.findFirst({
      where: { userId: auth.userId },
      orderBy: { priority: "desc" },
      select: { priority: true },
    });
    const rule = await prisma.mailRule.create({
      data: {
        userId: auth.userId,
        name: body.name,
        enabled: body.enabled,
        mode: compiled.mode,
        matchType: compiled.matchType,
        conditions: compiled.conditions as unknown as Prisma.InputJsonValue,
        expression: compiled.expression as unknown as Prisma.InputJsonValue,
        actions: compiled.actions as unknown as Prisma.InputJsonValue,
        sieveScript: compiled.sieveScript,
        stopProcessing: compiled.stopProcessing,
        priority: (last?.priority ?? -1) + 1,
      },
    });
    return json({ rule: mailRuleToDTO(rule), warnings: compiled.warnings }, { status: 201 });
  });
}
