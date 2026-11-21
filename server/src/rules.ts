import type {
  MailRuleDTO,
  RuleAction,
  RuleCondition,
  RuleEvaluationResult,
  RuleExpression,
  RuleFolderTarget,
  RuleMatchType,
  RuleOperator,
} from "@nyxmail/shared";
import { domainOf, isRuleExpression, stripHtml } from "@nyxmail/shared";

export interface RuleContext {
  fromAddress: string;
  fromName?: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses?: string[];
  deliveredTo: string;
  /** Additional delivered-to addresses (for example the catch-all target). */
  deliveredToAddresses?: string[];
  subject: string;
  text: string;
  html: string;
  attachmentNames: string[];
  sizeBytes: number;
  spamScore: number;
  spf?: string | null;
  dkim?: string | null;
  dmarc?: string | null;
}

function textValues(field: RuleCondition["field"], context: RuleContext): string[] {
  switch (field) {
    case "from":
      return Array.from(
        new Set(
          [
            context.fromName ? `${context.fromName} <${context.fromAddress}>` : context.fromAddress,
            context.fromAddress,
            context.fromName || "",
          ].filter(Boolean),
        ),
      );
    case "fromName":
      return context.fromName ? [context.fromName] : [];
    case "senderDomain":
      return [domainOf(context.fromAddress)];
    case "to":
      return context.toAddresses;
    case "cc":
      return context.ccAddresses;
    case "bcc":
      return context.bccAddresses ?? [];
    case "recipient":
      return Array.from(
        new Set(
          [context.deliveredTo, ...(context.deliveredToAddresses ?? [])]
            .map((address) => address.trim())
            .filter(Boolean),
        ),
      );
    case "subject":
      return [context.subject];
    case "body":
      return [context.text, stripHtml(context.html)];
    case "any":
      return [
        context.fromAddress,
        context.fromName || "",
        ...context.toAddresses,
        ...context.ccAddresses,
        context.deliveredTo,
        ...(context.deliveredToAddresses ?? []),
        context.subject,
        context.text,
        stripHtml(context.html),
        ...context.attachmentNames,
      ];
    case "attachmentName":
      return context.attachmentNames;
    case "spf":
      return [context.spf || "none"];
    case "dkim":
      return [context.dkim || "none"];
    case "dmarc":
      return [context.dmarc || "none"];
    default:
      return [];
  }
}

function numericalValue(field: RuleCondition["field"], context: RuleContext): number | null {
  if (field === "size") return context.sizeBytes;
  if (field === "spamScore") return context.spamScore;
  return null;
}

function booleanValue(field: RuleCondition["field"], context: RuleContext): boolean | null {
  if (field === "hasAttachment") return context.attachmentNames.length > 0;
  return null;
}

function globToRegExp(pattern: string): RegExp | null {
  if (!pattern || pattern.length > 200) return null;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(`^${escaped}$`, "i");
  } catch {
    return null;
  }
}

function compareStrings(values: string[], operator: RuleOperator, rawValue: string): boolean {
  const value = rawValue.trim();
  const lower = value.toLowerCase();
  const candidates = values.map((item) => item.toLowerCase());
  switch (operator) {
    case "contains":
      return candidates.some((item) => item.includes(lower));
    case "notContains":
      return candidates.every((item) => !item.includes(lower));
    case "equals":
    case "is":
      return candidates.some((item) => item === lower);
    case "notEquals":
    case "isNot":
      return candidates.every((item) => item !== lower);
    case "startsWith":
      return candidates.some((item) => item.startsWith(lower));
    case "endsWith":
      return candidates.some((item) => item.endsWith(lower));
    case "matchesGlob": {
      const regex = globToRegExp(value);
      return regex ? candidates.some((item) => regex.test(item)) : false;
    }
    default:
      return false;
  }
}

export function conditionMatches(condition: RuleCondition, context: RuleContext): boolean {
  if (condition.field === "hasAttachment") {
    const actual = booleanValue(condition.field, context);
    const expected =
      typeof condition.value === "boolean"
        ? condition.value
        : String(condition.value).toLowerCase() === "true";
    if (condition.operator === "isNot" || condition.operator === "notEquals") return actual !== expected;
    return actual === expected;
  }

  const numeric = numericalValue(condition.field, context);
  if (numeric !== null) {
    const value = Number(condition.value);
    if (!Number.isFinite(value)) return false;
    switch (condition.operator) {
      case "greaterThan":
        return numeric > value;
      case "greaterOrEqual":
        return numeric >= value;
      case "lessThan":
        return numeric < value;
      case "lessOrEqual":
        return numeric <= value;
      case "equals":
      case "is":
        return numeric === value;
      case "notEquals":
      case "isNot":
        return numeric !== value;
      default:
        return false;
    }
  }

  return compareStrings(textValues(condition.field, context), condition.operator, String(condition.value ?? ""));
}

export function expressionMatches(expression: RuleExpression, context: RuleContext): boolean {
  if (expression.kind === "condition") {
    return conditionMatches(expression, context);
  }
  if (expression.kind === "anyof") {
    return expression.children.some((child) => expressionMatches(child, context));
  }
  return expression.children.every((child) => expressionMatches(child, context));
}

export function ruleMatches(
  rule: Pick<MailRuleDTO, "conditions" | "matchType"> & { expression?: unknown },
  context: RuleContext,
): boolean {
  if (isRuleExpression(rule.expression)) {
    return expressionMatches(rule.expression, context);
  }
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) return false;
  if (rule.matchType === "ANY") {
    return rule.conditions.some((condition) => conditionMatches(condition, context));
  }
  return rule.conditions.every((condition) => conditionMatches(condition, context));
}

function applyAction(
  action: RuleAction,
  result: RuleEvaluationResult,
): RuleEvaluationResult {
  switch (action.type) {
    case "move":
      if (action.folderId) {
        result.folderTarget = { kind: "move", folderId: action.folderId } satisfies RuleFolderTarget;
      }
      break;
    case "archive":
      result.folderTarget = { kind: "archive" };
      break;
    case "spam":
      result.folderTarget = { kind: "spam" };
      break;
    case "trash":
      result.folderTarget = { kind: "trash" };
      break;
    case "addLabel":
      for (const id of action.labelIds ?? []) {
        if (!result.labelIds.includes(id)) result.labelIds.push(id);
      }
      break;
    case "markRead":
      result.markRead = true;
      break;
    case "markUnread":
      result.markRead = false;
      break;
    case "star":
      result.star = true;
      break;
    case "unstar":
      result.star = false;
      break;
  }
  return result;
}

/**
 * Evaluate ordered user rules against an incoming message. The last folder
 * action wins, labels accumulate, and a stopProcessing rule ends evaluation.
 */
export function evaluateRules(
  rules: Array<
    Pick<
      MailRuleDTO,
      | "id"
      | "name"
      | "enabled"
      | "priority"
      | "matchType"
      | "conditions"
      | "actions"
      | "stopProcessing"
    > & { expression?: unknown }
  >,
  context: RuleContext,
): RuleEvaluationResult {
  const result: RuleEvaluationResult = {
    matchedRuleIds: [],
    folderTarget: null,
    labelIds: [],
    stopped: false,
  };

  const ordered = [...rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority);

  for (const rule of ordered) {
    if (!ruleMatches(rule, context)) continue;
    result.matchedRuleIds.push(rule.id);
    for (const action of rule.actions) applyAction(action, result);
    if (rule.stopProcessing) {
      result.stopped = true;
      break;
    }
  }

  return result;
}

export function ruleMatchType(value: string): RuleMatchType {
  return value === "ANY" ? "ANY" : "ALL";
}
