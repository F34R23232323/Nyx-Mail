import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { assertTrustedOrigin, json, parseBody, safe } from "@/lib/http";
import { compileRuleForUser } from "@/lib/rule-compile";
import { sieveValidateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return safe(async () => {
    assertTrustedOrigin(request);
    const auth = await requireAuth(request, { csrf: true });
    const body = await parseBody(request, sieveValidateSchema);
    const compiled = await compileRuleForUser(auth.userId, {
      mode: "SIEVE",
      sieveScript: body.script,
    });
    return json({
      ok: true,
      matchType: compiled.matchType,
      conditions: compiled.conditions,
      expression: compiled.expression,
      actions: compiled.actions,
      stopProcessing: compiled.stopProcessing,
      warnings: compiled.warnings,
    });
  });
}
