import { prisma } from "@nyxmail/db";
import { compileSieve, SieveCompileError } from "@nyxmail/server";
import type {
  RuleAction,
  RuleCondition,
  RuleExpression,
  RuleMatchType,
  RuleMode,
} from "@nyxmail/shared";
import { ApiError } from "./http";

export interface RuleCompileInput {
  mode: RuleMode;
  sieveScript?: string | null;
  matchType?: RuleMatchType;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  stopProcessing?: boolean;
}

export interface CompiledRuleInput {
  mode: RuleMode;
  sieveScript: string | null;
  matchType: RuleMatchType;
  conditions: RuleCondition[];
  expression: RuleExpression | null;
  actions: RuleAction[];
  stopProcessing: boolean;
  warnings: string[];
}

/**
 * Raw Sieve is compiled to the same condition/action JSON used by the visual
 * editor. That keeps ingress evaluation in one place and means a raw filter
 * behaves exactly like its visual equivalent.
 */
export async function compileRuleForUser(
  userId: string,
  input: RuleCompileInput,
): Promise<CompiledRuleInput> {
  if (input.mode === "SIEVE") {
    const script = input.sieveScript?.trim();
    if (!script) {
      throw new ApiError(400, "Paste a Sieve script before saving", "sieve_required");
    }
    const [folders, labels] = await Promise.all([
      prisma.folder.findMany({
        where: { userId },
        select: { id: true, name: true, type: true },
        orderBy: { name: "asc" },
      }),
      prisma.label.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    try {
      const result = compileSieve(script, { folders, labels });
      return {
        mode: "SIEVE",
        sieveScript: script,
        matchType: result.matchType,
        conditions: result.conditions,
        expression: result.expression,
        actions: result.actions,
        stopProcessing: result.stopProcessing,
        warnings: result.warnings,
      };
    } catch (error) {
      if (error instanceof SieveCompileError) {
        throw new ApiError(400, error.message, "sieve_invalid");
      }
      throw error;
    }
  }

  const conditions = input.conditions ?? [];
  const actions = input.actions ?? [];
  if (conditions.length === 0) {
    throw new ApiError(400, "Add at least one condition", "invalid_rule");
  }
  if (actions.length === 0) {
    throw new ApiError(400, "Add at least one action", "invalid_rule");
  }
  return {
    mode: "VISUAL",
    sieveScript: null,
    matchType: input.matchType ?? "ALL",
    conditions,
    expression: null,
    actions,
    stopProcessing: input.stopProcessing ?? false,
    warnings: [],
  };
}
