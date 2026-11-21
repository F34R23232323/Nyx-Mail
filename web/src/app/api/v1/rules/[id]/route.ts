import type { NextRequest } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { mailRuleUpdateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import { ApiError, assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { mailRuleToDTO } from "@/lib/serializers";
import { compileRuleForUser } from "@/lib/rule-compile";
import { validateRuleResources } from "@/lib/rule-validation";
import type { RuleAction, RuleCondition, RuleMatchType, RuleMode } from "@nyxmail/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const existing = await prisma.mailRule.findFirst({
      where: { id: context.params.id, userId: auth.userId },
    });
    if (!existing) throw new ApiError(404, "Rule not found", "not_found");
    const body = await parseBody(request, mailRuleUpdateSchema);
    if (Object.keys(body).length === 0) throw new ApiError(400, "Nothing to update", "invalid_rule");

    const evaluationChanged =
      body.mode !== undefined ||
      body.sieveScript !== undefined ||
      body.matchType !== undefined ||
      body.conditions !== undefined ||
      body.actions !== undefined ||
      body.stopProcessing !== undefined;

    let compiled:
      | Awaited<ReturnType<typeof compileRuleForUser>>
      | null = null;
    if (evaluationChanged) {
      const mode = (body.mode ?? existing.mode) as RuleMode;
      compiled = await compileRuleForUser(auth.userId, {
        mode,
        sieveScript: body.sieveScript ?? existing.sieveScript,
        matchType: (body.matchType ?? existing.matchType) as RuleMatchType,
        conditions:
          body.conditions ??
          (existing.conditions as unknown as RuleCondition[]),
        actions: body.actions ?? (existing.actions as unknown as RuleAction[]),
        stopProcessing: body.stopProcessing ?? existing.stopProcessing,
      });
      await validateRuleResources(auth.userId, compiled.actions);
    }

    const rule = await prisma.mailRule.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(compiled
          ? {
              mode: compiled.mode,
              matchType: compiled.matchType,
              conditions: compiled.conditions as unknown as Prisma.InputJsonValue,
              expression: compiled.expression as unknown as Prisma.InputJsonValue,
              actions: compiled.actions as unknown as Prisma.InputJsonValue,
              sieveScript: compiled.sieveScript,
              stopProcessing: compiled.stopProcessing,
            }
          : {}),
      },
    });
    return json({ rule: mailRuleToDTO(rule), warnings: compiled?.warnings ?? [] });
  });
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const existing = await prisma.mailRule.findFirst({
      where: { id: context.params.id, userId: auth.userId },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "Rule not found", "not_found");
    await prisma.mailRule.delete({ where: { id: existing.id } });
    return json({ ok: true });
  });
}
