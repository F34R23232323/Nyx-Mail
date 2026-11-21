export const RULE_MATCH_TYPES = ["ALL", "ANY"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const RULE_MODES = ["VISUAL", "SIEVE"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

export const RULE_FIELDS = [
  "from",
  "fromName",
  "senderDomain",
  "to",
  "cc",
  "bcc",
  "recipient",
  "subject",
  "body",
  "any",
  "attachmentName",
  "hasAttachment",
  "size",
  "spamScore",
  "spf",
  "dkim",
  "dmarc",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "matchesGlob",
  "is",
  "isNot",
  "greaterThan",
  "greaterOrEqual",
  "lessThan",
  "lessOrEqual",
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string | number | boolean;
}

export const RULE_ACTION_TYPES = [
  "move",
  "addLabel",
  "markRead",
  "markUnread",
  "star",
  "unstar",
  "archive",
  "spam",
  "trash",
] as const;
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

export interface RuleAction {
  type: RuleActionType;
  folderId?: string;
  labelIds?: string[];
}

export type RuleExpression =
  | {
      kind: "condition";
      field: RuleField;
      operator: RuleOperator;
      value: string | number | boolean;
    }
  | {
      kind: "allof" | "anyof";
      children: RuleExpression[];
    };

export function isRuleExpression(value: unknown): value is RuleExpression {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.kind === "condition") {
    return (
      typeof node.field === "string" &&
      (RULE_FIELDS as readonly string[]).includes(node.field) &&
      typeof node.operator === "string" &&
      (RULE_OPERATORS as readonly string[]).includes(node.operator) &&
      (typeof node.value === "string" ||
        typeof node.value === "number" ||
        typeof node.value === "boolean")
    );
  }
  if (node.kind === "allof" || node.kind === "anyof") {
    return (
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every((child) => isRuleExpression(child))
    );
  }
  return false;
}

export interface MailRuleDTO {
  id: string;
  name: string;
  enabled: boolean;
  mode: RuleMode;
  priority: number;
  matchType: RuleMatchType;
  conditions: RuleCondition[];
  expression: RuleExpression | null;
  actions: RuleAction[];
  sieveScript: string | null;
  stopProcessing: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RuleFolderTargetKind = "move" | "archive" | "spam" | "trash";

export interface RuleFolderTarget {
  kind: RuleFolderTargetKind;
  folderId?: string;
}

export interface RuleEvaluationResult {
  matchedRuleIds: string[];
  folderTarget: RuleFolderTarget | null;
  labelIds: string[];
  /** undefined means the rule did not change the default. */
  markRead?: boolean;
  star?: boolean;
  stopped: boolean;
}
