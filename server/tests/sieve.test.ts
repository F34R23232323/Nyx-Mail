import { describe, expect, it } from "vitest";
import { compileSieve, SieveCompileError, type SieveCompileOptions } from "../src/sieve";

const options: SieveCompileOptions = {
  folders: [
    { id: "inbox", name: "Inbox", type: "INBOX" },
    { id: "archive", name: "Archive", type: "ARCHIVE" },
    { id: "spam", name: "Spam", type: "SPAM" },
    { id: "trash", name: "Trash", type: "TRASH" },
    { id: "dev", name: "Dev", type: "CUSTOM" },
    { id: "nested", name: "Google/Gmail", type: "CUSTOM" },
    { id: "burner-emails", name: "Burner Emails", type: "CUSTOM" },
    { id: "billing-stripe", name: "Billing/Stripe", type: "CUSTOM" },
    { id: "billing-fiverr", name: "Billing/Fiverr", type: "CUSTOM" },
  ],
  labels: [
    { id: "label-build", name: "Builds" },
    { id: "label-important", name: "Important" },
    { id: "label-burner", name: "Burner" },
    { id: "label-stripe", name: "Stripe Emails" },
    { id: "label-fiverr", name: "Fiverr Emails" },
  ],
};

describe("raw Sieve compiler", () => {
  it("compiles common header conditions and actions", () => {
    const result = compileSieve(
      `require ["fileinto", "imap4flags"];
       if allof (
         header :contains "From" "@github.com",
         header :contains "Subject" "[build]"
       ) {
         fileinto "Dev";
         addflag "\\\\Seen";
         stop;
       }`,
      options,
    );
    expect(result.matchType).toBe("ALL");
    expect(result.conditions).toEqual([
      { field: "from", operator: "contains", value: "@github.com" },
      { field: "subject", operator: "contains", value: "[build]" },
    ]);
    expect(result.actions).toEqual([
      { type: "move", folderId: "dev" },
      { type: "markRead" },
    ]);
    expect(result.stopProcessing).toBe(true);
    expect(result.capabilities).toEqual(["fileinto", "imap4flags"]);
  });

  it("supports anyof, address domains and body tests", () => {
    const result = compileSieve(
      `require ["fileinto", "body"];
       if anyof (
         address :domain :is "From" "example.com",
         body :contains "unsubscribe"
       ) {
         fileinto "Archive";
       }`,
      options,
    );
    expect(result.matchType).toBe("ANY");
    expect(result.conditions).toEqual([
      { field: "senderDomain", operator: "equals", value: "example.com" },
      { field: "body", operator: "contains", value: "unsubscribe" },
    ]);
    expect(result.actions).toEqual([{ type: "archive" }]);
  });

  it("supports size, negated tests, labels and nested folders", () => {
    const result = compileSieve(
      `require ["fileinto", "imap4flags"];
       if allof (size :over 1M, not header :contains "Subject" "receipt") {
         fileinto "Google/Gmail";
         addlabel "Builds";
         addflag "\\\\Flagged";
       }`,
      options,
    );
    expect(result.conditions).toEqual([
      { field: "size", operator: "greaterThan", value: 1024 * 1024 },
      { field: "subject", operator: "notContains", value: "receipt" },
    ]);
    expect(result.actions).toEqual([
      { type: "move", folderId: "nested" },
      { type: "addLabel", labelIds: ["label-build"] },
      { type: "star" },
    ]);
  });

  it("maps system folders to their visual actions", () => {
    const result = compileSieve(
      `if header :is "Subject" "spam" { fileinto "Spam"; }
       `,
      options,
    );
    expect(result.actions).toEqual([{ type: "spam" }]);
  });

  it("rejects missing folders, unsupported actions and multiple if blocks", () => {
    expect(() =>
      compileSieve('if header :contains "From" "x" { fileinto "Missing"; }', options),
    ).toThrow(SieveCompileError);

    expect(() =>
      compileSieve('if header :contains "From" "x" { redirect "other@example.com"; }', options),
    ).toThrow(/disabled/);

    expect(() =>
      compileSieve(
        'if header :contains "From" "a" { fileinto "Dev"; } if header :contains "From" "b" { fileinto "Dev"; }',
        options,
      ),
    ).toThrow(/one main if block/i);
  });

  it("compiles the Proton burner-address script", () => {
    const script = `require ["include", "environment", "variables", "relational", "comparator-i;ascii-numeric", "spamtest"];
require ["fileinto", "imap4flags"];

# Do not run this script on spam messages.
if allof (
    environment :matches "vnd.proton.spam-threshold" "*",
    spamtest :value "ge" :comparator "i;ascii-numeric" "\${1}"
) {
    return;
}

# Match mail delivered specifically to the burner address.
if allof (
    address :all :comparator "i;unicode-casemap" :is
        "Delivered-To" "burner@example.net",

    not address :all :comparator "i;unicode-casemap" :is
        ["To", "Cc", "Bcc"] "support@example.net",

    not address :all :comparator "i;unicode-casemap" :contains
        "From" "@e.fiverr.com",

    not address :all :comparator "i;unicode-casemap" :contains
        "From" "@status.incident.io",

    not address :all :comparator "i;unicode-casemap" :contains
        "From" "notifications@example.org"
) {
    fileinto "Burner Emails";
    fileinto "Burner";
    addflag "\\\\Seen";
    keep;
}`;
    const result = compileSieve(script, options);
    expect(result.matchType).toBe("ALL");
    expect(result.conditions).toEqual([
      { field: "recipient", operator: "equals", value: "burner@example.net" },
      { field: "to", operator: "isNot", value: "support@example.net" },
      { field: "cc", operator: "isNot", value: "support@example.net" },
      { field: "bcc", operator: "isNot", value: "support@example.net" },
      { field: "from", operator: "notContains", value: "@e.fiverr.com" },
      { field: "from", operator: "notContains", value: "@status.incident.io" },
      { field: "from", operator: "notContains", value: "notifications@example.org" },
      { field: "spamScore", operator: "lessThan", value: 5 },
    ]);
    expect(result.actions).toEqual([
      { type: "move", folderId: "burner-emails" },
      { type: "addLabel", labelIds: ["label-burner"] },
      { type: "markRead" },
    ]);
    expect(result.stopProcessing).toBe(false);
    expect(result.warnings.join(" ")).toContain("spam threshold");
    expect(result.warnings.join(" ")).toContain("matched a label");
  });

  it("accepts Proton block comments and folder-plus-label actions", () => {
    const script = `require ["include", "environment", "variables", "relational", "comparator-i;ascii-numeric", "spamtest"];
require ["fileinto", "imap4flags"];

# Generated: Do not run this script on spam messages
if allof (environment :matches "vnd.proton.spam-threshold" "*", spamtest :value "ge" :comparator "i;ascii-numeric" "\${1}") {
    return;
}

/**
 * @type and
 * @comparator contains
 */
if allof (address :all :comparator "i:unicode-casemap" :contains "From" "@stripe.com") {
    fileinto "Billing/Stripe";
    fileinto "Stripe Emails";
}`;
    const result = compileSieve(script, options);
    expect(result.conditions).toEqual([
      { field: "from", operator: "contains", value: "@stripe.com" },
      { field: "spamScore", operator: "lessThan", value: 5 },
    ]);
    expect(result.actions).toEqual([
      { type: "move", folderId: "billing-stripe" },
      { type: "addLabel", labelIds: ["label-stripe"] },
    ]);
    expect(result.warnings.join(" ")).toContain("matched a label");
  });

  it("supports string lists as match values", () => {
    const result = compileSieve(
      `require ["fileinto"];
if allof (address :all :comparator "i:unicode-casemap" :contains "From" ["@fiverr.com", "@e.fiverr.com"]) {
    fileinto "Billing/Fiverr";
    fileinto "Fiverr Emails";
}`,
      options,
    );
    expect(result.expression).toEqual({
      kind: "allof",
      children: [
        {
          kind: "anyof",
          children: [
            { kind: "condition", field: "from", operator: "contains", value: "@fiverr.com" },
            { kind: "condition", field: "from", operator: "contains", value: "@e.fiverr.com" },
          ],
        },
      ],
    });
    expect(result.actions).toEqual([
      { type: "move", folderId: "billing-fiverr" },
      { type: "addLabel", labelIds: ["label-fiverr"] },
    ]);
  });

  it("preserves nested anyof inside allof as an expression tree", () => {
    const result = compileSieve(
      'if anyof (allof (header :contains "From" "a", header :contains "Subject" "b"), header :contains "From" "c") { fileinto "Dev"; }',
      options,
    );
    expect(result.expression).toEqual({
      kind: "anyof",
      children: [
        {
          kind: "allof",
          children: [
            { kind: "condition", field: "from", operator: "contains", value: "a" },
            { kind: "condition", field: "subject", operator: "contains", value: "b" },
          ],
        },
        { kind: "condition", field: "from", operator: "contains", value: "c" },
      ],
    });
    expect(result.actions).toEqual([{ type: "move", folderId: "dev" }]);
  });
});
