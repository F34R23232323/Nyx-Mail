import { describe, expect, it } from "vitest";
import type { MailRuleDTO } from "@nyxmail/shared";
import { conditionMatches, evaluateRules, ruleMatches, type RuleContext } from "../src/rules";

const context: RuleContext = {
  fromAddress: "notifications@github.com",
  fromName: "GitHub",
  toAddresses: ["you@example.com"],
  ccAddresses: [],
  deliveredTo: "you@example.com",
  subject: "Build failed on main",
  text: "The workflow failed. Review the logs.",
  html: "<p>The workflow failed. Review the logs.</p>",
  attachmentNames: ["build.log"],
  sizeBytes: 2_500_000,
  spamScore: 1.5,
  spf: "pass",
  dkim: "pass",
  dmarc: "pass",
};

function rule(overrides: Partial<MailRuleDTO> = {}): MailRuleDTO {
  return {
    id: "rule-1",
    name: "GitHub notifications",
    enabled: true,
    mode: "VISUAL",
    priority: 0,
    matchType: "ALL",
    conditions: [{ field: "senderDomain", operator: "equals", value: "github.com" }],
    expression: null,
    actions: [{ type: "move", folderId: "folder-dev" }],
    sieveScript: null,
    stopProcessing: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sieve-like rule conditions", () => {
  it("matches sender domains and subjects", () => {
    expect(
      conditionMatches(
        { field: "senderDomain", operator: "equals", value: "github.com" },
        context,
      ),
    ).toBe(true);
    expect(
      conditionMatches({ field: "subject", operator: "contains", value: "build failed" }, context),
    ).toBe(true);
    expect(
      conditionMatches({ field: "body", operator: "contains", value: "logs" }, context),
    ).toBe(true);
  });

  it("supports glob patterns", () => {
    expect(
      conditionMatches(
        { field: "subject", operator: "matchesGlob", value: "Build * main" },
        context,
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: "from", operator: "matchesGlob", value: "*@gitlab.com" },
        context,
      ),
    ).toBe(false);
  });

  it("supports attachment and size conditions", () => {
    expect(
      conditionMatches({ field: "hasAttachment", operator: "is", value: true }, context),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: "attachmentName", operator: "endsWith", value: ".log" },
        context,
      ),
    ).toBe(true);
    expect(
      conditionMatches({ field: "size", operator: "greaterThan", value: 1_000_000 }, context),
    ).toBe(true);
    expect(
      conditionMatches({ field: "size", operator: "lessThan", value: 100 }, context),
    ).toBe(false);
  });

  it("evaluates nested anyof inside allof expressions", () => {
    const expression = {
      kind: "allof" as const,
      children: [
        { kind: "condition" as const, field: "senderDomain" as const, operator: "equals" as const, value: "github.com" },
        {
          kind: "anyof" as const,
          children: [
            { kind: "condition" as const, field: "subject" as const, operator: "contains" as const, value: "build" },
            { kind: "condition" as const, field: "body" as const, operator: "contains" as const, value: "logs" },
          ],
        },
      ],
    };
    expect(
      ruleMatches({ matchType: "ALL", conditions: [], expression }, context),
    ).toBe(true);
    expect(
      ruleMatches(
        {
          matchType: "ALL",
          conditions: [],
          expression: {
            ...expression,
            children: [
              expression.children[0],
              { kind: "anyof", children: [
                { kind: "condition", field: "subject", operator: "contains", value: "nomatch" },
                { kind: "condition", field: "body", operator: "contains", value: "nomatch" },
              ] },
            ],
          },
        },
        context,
      ),
    ).toBe(false);
  });

  it("supports auth results and any/all matching", () => {
    expect(ruleMatches({ matchType: "ALL", conditions: rule().conditions }, context)).toBe(true);
    expect(
      ruleMatches(
        {
          matchType: "ANY",
          conditions: [
            { field: "senderDomain", operator: "equals", value: "gitlab.com" },
            { field: "dkim", operator: "equals", value: "pass" },
          ],
        },
        context,
      ),
    ).toBe(true);
  });

  it("matches delivered-to conditions against catch-all targets", () => {
    const catchAllContext: RuleContext = {
      ...context,
      deliveredTo: "anything@example.com",
      deliveredToAddresses: ["anything@example.com", "burner@example.com"],
    };
    expect(
      conditionMatches(
        { field: "recipient", operator: "equals", value: "burner@example.com" },
        catchAllContext,
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: "recipient", operator: "equals", value: "anything@example.com" },
        catchAllContext,
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: "recipient", operator: "isNot", value: "burner@example.com" },
        catchAllContext,
      ),
    ).toBe(false);
  });
});

describe("rule actions", () => {
  it("combines move, label, read and star actions", () => {
    const result = evaluateRules(
      [
        rule({
          actions: [
            { type: "move", folderId: "folder-dev" },
            { type: "addLabel", labelIds: ["label-builds"] },
            { type: "markRead" },
            { type: "star" },
          ],
        }),
      ],
      context,
    );
    expect(result.matchedRuleIds).toEqual(["rule-1"]);
    expect(result.folderTarget).toEqual({ kind: "move", folderId: "folder-dev" });
    expect(result.labelIds).toEqual(["label-builds"]);
    expect(result.markRead).toBe(true);
    expect(result.star).toBe(true);
  });

  it("lets the last folder action win and honors stopProcessing", () => {
    const result = evaluateRules(
      [
        rule({
          id: "rule-1",
          priority: 0,
          actions: [{ type: "move", folderId: "folder-dev" }, { type: "trash" }],
          stopProcessing: true,
        }),
        rule({
          id: "rule-2",
          priority: 1,
          conditions: [{ field: "subject", operator: "contains", value: "failed" }],
          actions: [{ type: "archive" }],
        }),
      ],
      context,
    );
    expect(result.folderTarget).toEqual({ kind: "trash" });
    expect(result.stopped).toBe(true);
    expect(result.matchedRuleIds).toEqual(["rule-1"]);
  });

  it("ignores disabled rules", () => {
    const result = evaluateRules([rule({ enabled: false })], context);
    expect(result.matchedRuleIds).toEqual([]);
    expect(result.folderTarget).toBeNull();
  });
});
