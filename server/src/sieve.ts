import type {
  RuleAction,
  RuleCondition,
  RuleExpression,
  RuleMatchType,
  RuleOperator,
} from "@nyxmail/shared";

/**
 * A deliberately small Sieve compiler for the subset that maps cleanly onto
 * NyxMail's visual rule model. It is not a full RFC 5228 interpreter: scripts
 * are compiled to the same conditions/actions the visual editor produces, so
 * every raw filter is evaluated by the same tested ingress path.
 */

export interface SieveFolder {
  id: string;
  name: string;
  type: string;
}

export interface SieveLabel {
  id: string;
  name: string;
}

export interface SieveCompileOptions {
  folders: SieveFolder[];
  labels: SieveLabel[];
}

export interface SieveCompileResult {
  matchType: RuleMatchType;
  conditions: RuleCondition[];
  expression: RuleExpression;
  actions: RuleAction[];
  stopProcessing: boolean;
  warnings: string[];
  capabilities: string[];
}

export class SieveCompileError extends Error {
  constructor(
    message: string,
    readonly line = 1,
    readonly column = 1,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "SieveCompileError";
  }
}

interface Token {
  type: "word" | "string" | "number" | "punct";
  value: string;
  line: number;
  column: number;
}

type TestNode =
  | {
      kind: "test";
      name: string;
      tags: string[];
      headers?: string[];
      values?: string[];
      number?: string;
      token: Token;
    }
  | { kind: "allof" | "anyof"; tests: TestNode[]; token: Token }
  | { kind: "not"; test: TestNode; token: Token };

type ActionNode =
  | { kind: "fileinto"; folder: string; copy: boolean; token: Token }
  | { kind: "addlabel"; label: string; token: Token }
  | {
      kind: "flag";
      mode: "add" | "set" | "remove";
      flags: string[];
      token: Token;
    }
  | { kind: "stop"; token: Token }
  | { kind: "return"; token: Token }
  | { kind: "keep"; token: Token };

interface ParsedBlock {
  test: TestNode;
  actions: ActionNode[];
  token: Token;
}

const NYXMAIL_SPAM_THRESHOLD = 5;

const MAX_SCRIPT_LENGTH = 20_000;
const MAX_TOKENS = 5_000;

function tokenize(script: string): Token[] {
  if (script.length > MAX_SCRIPT_LENGTH) {
    throw new SieveCompileError(`Script is limited to ${MAX_SCRIPT_LENGTH} characters`);
  }
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const fail = (message: string): never => {
    throw new SieveCompileError(message, line, column);
  };

  while (index < script.length) {
    const char = script[index]!;
    if (char === "\n") {
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    if (char === "\r" || char === " " || char === "\t") {
      index += 1;
      column += 1;
      continue;
    }
    if (char === "#") {
      while (index < script.length && script[index] !== "\n") {
        index += 1;
        column += 1;
      }
      continue;
    }
    if (char === "/" && script[index + 1] === "*") {
      const startLine = line;
      const startColumn = column;
      index += 2;
      column += 2;
      let closed = false;
      while (index < script.length) {
        if (script[index] === "*" && script[index + 1] === "/") {
          index += 2;
          column += 2;
          closed = true;
          break;
        }
        if (script[index] === "\n") {
          index += 1;
          line += 1;
          column = 1;
        } else {
          index += 1;
          column += 1;
        }
      }
      if (!closed) {
        throw new SieveCompileError("Unterminated block comment", startLine, startColumn);
      }
      continue;
    }
    if (char === "/" && script[index + 1] === "/") {
      while (index < script.length && script[index] !== "\n") {
        index += 1;
        column += 1;
      }
      continue;
    }
    if (char === '"') {
      const startLine = line;
      const startColumn = column;
      index += 1;
      column += 1;
      let value = "";
      let closed = false;
      while (index < script.length) {
        const current = script[index]!;
        if (current === "\\") {
          const next = script[index + 1];
          if (next === undefined) fail("Unterminated escaped character");
          value += next;
          index += 2;
          column += 2;
          continue;
        }
        if (current === '"') {
          index += 1;
          column += 1;
          closed = true;
          break;
        }
        if (current === "\n") {
          line += 1;
          column = 1;
          value += current;
          index += 1;
          continue;
        }
        value += current;
        index += 1;
        column += 1;
      }
      if (!closed) fail("Unterminated quoted string");
      tokens.push({ type: "string", value, line: startLine, column: startColumn });
      continue;
    }
    if ("{}()[];,".includes(char)) {
      tokens.push({ type: "punct", value: char, line, column });
      index += 1;
      column += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let value = "";
      while (index < script.length && /[0-9A-Za-z]/.test(script[index]!)) {
        value += script[index];
        index += 1;
        column += 1;
      }
      tokens.push({ type: "number", value, line, column });
      continue;
    }
    if (/[A-Za-z_:]/.test(char)) {
      let value = "";
      while (index < script.length && /[A-Za-z0-9_:.-]/.test(script[index]!)) {
        value += script[index];
        index += 1;
        column += 1;
      }
      tokens.push({ type: "word", value, line, column });
      continue;
    }
    fail(`Unexpected character "${char}"`);
  }

  if (tokens.length > MAX_TOKENS) {
    throw new SieveCompileError(`Script is limited to ${MAX_TOKENS} tokens`);
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly options: SieveCompileOptions,
  ) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private at(value: string): boolean {
    return this.peek()?.value === value;
  }

  private consume(): Token {
    const token = this.peek();
    if (!token) {
      const last = this.tokens[this.tokens.length - 1];
      throw new SieveCompileError("Unexpected end of script", last?.line ?? 1, last?.column ?? 1);
    }
    this.index += 1;
    return token;
  }

  private expect(value: string): Token {
    const token = this.peek();
    if (!token || token.value !== value) {
      throw new SieveCompileError(
        `Expected "${value}"${token ? `, found "${token.value}"` : ""}`,
        token?.line ?? 1,
        token?.column ?? 1,
      );
    }
    return this.consume();
  }

  private expectType(type: Token["type"], description: string): Token {
    const token = this.peek();
    if (!token || token.type !== type) {
      throw new SieveCompileError(
        `Expected ${description}${token ? `, found "${token.value}"` : ""}`,
        token?.line ?? 1,
        token?.column ?? 1,
      );
    }
    return this.consume();
  }

  private expectString(): string {
    return this.expectType("string", "a quoted string").value;
  }

  parse(): { blocks: ParsedBlock[]; capabilities: string[] } {
    const capabilities: string[] = [];
    while (this.at("require")) {
      capabilities.push(...this.parseRequire());
    }
    const blocks: ParsedBlock[] = [];
    while (this.at("if")) {
      const token = this.consume();
      const test = this.parseTest();
      this.expect("{");
      const actions: ActionNode[] = [];
      while (!this.at("}")) {
        if (!this.peek()) {
          throw new SieveCompileError("Missing closing }", token.line, token.column);
        }
        actions.push(this.parseAction());
      }
      this.expect("}");
      if (actions.length === 0) {
        throw new SieveCompileError("The if block needs at least one action", token.line, token.column);
      }
      if (this.at("elsif") || this.at("else")) {
        const trailing = this.peek()!;
        throw new SieveCompileError(
          "elsif/else is not supported in a single raw filter. Create a separate filter for each branch.",
          trailing.line,
          trailing.column,
        );
      }
      blocks.push({ test, actions, token });
    }
    if (blocks.length === 0) {
      const token = this.peek();
      throw new SieveCompileError(
        'Raw Sieve needs an "if" block. Wrap actions in "if <condition> { ... }".',
        token?.line ?? 1,
        token?.column ?? 1,
      );
    }
    if (this.peek()) {
      const trailing = this.peek()!;
      throw new SieveCompileError(
        `Unexpected "${trailing.value}". Use one main if block per raw filter.`,
        trailing.line,
        trailing.column,
      );
    }
    return { blocks, capabilities };
  }

  private expectStringList(): string[] {
    if (!this.at("[")) return [this.expectString()];
    this.expect("[");
    const values: string[] = [];
    while (!this.at("]")) {
      values.push(this.expectString());
      if (this.at(",")) this.consume();
      else break;
    }
    this.expect("]");
    if (values.length === 0) {
      throw new SieveCompileError("String list cannot be empty");
    }
    return values;
  }

  private parseRequire(): string[] {
    this.expect("require");
    const capabilities: string[] = [];
    if (this.at("[")) {
      this.expect("[");
      while (!this.at("]")) {
        capabilities.push(this.expectString());
        if (this.at(",")) this.consume();
        else break;
      }
      this.expect("]");
    } else {
      capabilities.push(this.expectString());
    }
    this.expect(";");
    return capabilities;
  }

  private parseTest(): TestNode {
    const token = this.peek();
    if (!token) throw new SieveCompileError("Expected a test");
    if (token.value === "allof" || token.value === "anyof") {
      this.consume();
      this.expect("(");
      const tests: TestNode[] = [];
      while (!this.at(")")) {
        tests.push(this.parseTest());
        if (this.at(",")) this.consume();
        else break;
      }
      this.expect(")");
      if (tests.length === 0) {
        throw new SieveCompileError(
          `${token.value} needs at least one test`,
          token.line,
          token.column,
        );
      }
      return { kind: token.value, tests, token };
    }
    if (token.value === "not") {
      this.consume();
      return { kind: "not", test: this.parseTest(), token };
    }
    return this.parseSimpleTest();
  }

  private parseTags(): string[] {
    const tags: string[] = [];
    while (this.peek()?.type === "word" && this.peek()!.value.startsWith(":")) {
      const tag = this.consume().value.toLowerCase();
      tags.push(tag);
      // Relational/comparator tags take a quoted argument before the next tag
      // or the actual test operands.
      if (tag === ":comparator" || tag === ":value") {
        if (this.peek()?.type === "string") this.consume();
      }
    }
    return tags;
  }

  private parseSimpleTest(): TestNode {
    const nameToken = this.expectType("word", "a test name");
    const name = nameToken.value.toLowerCase();
    const tags = this.parseTags();

    if (name === "size") {
      if (!tags.includes(":over") && !tags.includes(":under")) {
        throw new SieveCompileError(
          'size requires :over or :under, for example size :over 1M',
          nameToken.line,
          nameToken.column,
        );
      }
      const number = this.expectType("number", "a size such as 500K or 10M").value;
      return { kind: "test", name, tags, number, token: nameToken };
    }

    if (name === "header" || name === "address" || name === "body") {
      const headers = name === "body" ? undefined : this.expectStringList();
      const values = this.expectStringList();
      return { kind: "test", name, tags, headers, values, token: nameToken };
    }

    if (name === "environment") {
      const variable = this.expectString();
      const values = [this.expectString()];
      return { kind: "test", name, tags, headers: [variable], values, token: nameToken };
    }

    if (name === "spamtest") {
      const values = [this.expectString()];
      return { kind: "test", name, tags, values, token: nameToken };
    }

    if (name === "true" || name === "false") {
      throw new SieveCompileError(
        "true/false tests cannot be represented by the visual rule model",
        nameToken.line,
        nameToken.column,
      );
    }
    if (name === "exists") {
      throw new SieveCompileError(
        "exists is not supported. Use header/body tests against a known value.",
        nameToken.line,
        nameToken.column,
      );
    }

    throw new SieveCompileError(
      `Unsupported Sieve test "${nameToken.value}"`,
      nameToken.line,
      nameToken.column,
    );
  }

  private parseAction(): ActionNode {
    const token = this.expectType("word", "an action");
    const name = token.value.toLowerCase();

    if (name === "fileinto") {
      let copy = false;
      while (this.peek()?.type === "word" && this.peek()!.value.startsWith(":")) {
        const tag = this.consume().value.toLowerCase();
        if (tag === ":copy") copy = true;
        else {
          throw new SieveCompileError(
            `Unsupported fileinto tag "${tag}"`,
            token.line,
            token.column,
          );
        }
      }
      const folder = this.expectString();
      this.expect(";");
      return { kind: "fileinto", folder, copy, token };
    }

    if (name === "addlabel") {
      const label = this.expectString();
      this.expect(";");
      return { kind: "addlabel", label, token };
    }

    if (name === "addflag" || name === "setflag" || name === "removeflag") {
      const flags: string[] = [];
      if (this.at("[")) {
        this.expect("[");
        while (!this.at("]")) {
          flags.push(this.expectString());
          if (this.at(",")) this.consume();
          else break;
        }
        this.expect("]");
      } else {
        flags.push(this.expectString());
      }
      this.expect(";");
      const mode = name === "addflag" ? "add" : name === "setflag" ? "set" : "remove";
      return { kind: "flag", mode, flags, token };
    }

    if (name === "stop") {
      this.expect(";");
      return { kind: "stop", token };
    }

    if (name === "return") {
      this.expect(";");
      return { kind: "return", token };
    }

    if (name === "keep") {
      this.expect(";");
      return { kind: "keep", token };
    }

    if (["discard", "redirect", "vacation", "reject", "notify"].includes(name)) {
      throw new SieveCompileError(
        `The "${name}" action is disabled in NyxMail filters`,
        token.line,
        token.column,
      );
    }

    throw new SieveCompileError(
      `Unsupported Sieve action "${token.value}"`,
      token.line,
      token.column,
    );
  }

  private testNames(test: TestNode, names = new Set<string>()): Set<string> {
    if (test.kind === "test") {
      names.add(test.name);
    } else if (test.kind === "not") {
      this.testNames(test.test, names);
    } else {
      for (const child of test.tests) this.testNames(child, names);
    }
    return names;
  }

  private isProtonSpamGuard(block: ParsedBlock): boolean {
    if (!block.actions.every((action) => action.kind === "return" || action.kind === "stop")) {
      return false;
    }
    const names = this.testNames(block.test);
    return names.has("environment") && names.has("spamtest");
  }

  compile(): SieveCompileResult {
    const { blocks, capabilities } = this.parse();
    const warnings: string[] = [];
    let spamGuard = false;
    const mainBlocks: ParsedBlock[] = [];
    for (const block of blocks) {
      if (this.isProtonSpamGuard(block)) {
        if (spamGuard) {
          throw new SieveCompileError(
            "Only one Proton environment/spamtest guard is supported",
            block.token.line,
            block.token.column,
          );
        }
        spamGuard = true;
        warnings.push(
          `Proton's environment/spamtest guard was mapped to NyxMail's spam threshold (score < ${NYXMAIL_SPAM_THRESHOLD}).`,
        );
        continue;
      }
      mainBlocks.push(block);
    }
    if (mainBlocks.length === 0) {
      throw new SieveCompileError(
        "The script only contains a spam guard. Add a main if block with actions.",
      );
    }
    if (mainBlocks.length > 1) {
      throw new SieveCompileError(
        "Use one main if block per raw filter. Create separate filters for independent branches.",
        mainBlocks[1].token.line,
        mainBlocks[1].token.column,
      );
    }

    const block = mainBlocks[0];
    let expression = this.compileTest(block.test);
    if (spamGuard) {
      expression = {
        kind: "allof",
        children: [
          expression,
          {
            kind: "condition",
            field: "spamScore",
            operator: "lessThan",
            value: NYXMAIL_SPAM_THRESHOLD,
          },
        ],
      };
    }
    const summary = summarizeExpression(expression);

    const compiledActions: RuleAction[] = [];
    let stopProcessing = false;
    let sawKeep = false;
    let sawCopy = false;

    for (const action of block.actions) {
      if (action.kind === "stop" || action.kind === "return") {
        stopProcessing = true;
        continue;
      }
      if (action.kind === "keep") {
        sawKeep = true;
        continue;
      }
      if (action.kind === "fileinto") {
        if (action.copy) {
          sawCopy = true;
        }
        const folder = this.options.folders.find(
          (item) => item.name.toLowerCase() === action.folder.toLowerCase(),
        );
        if (folder) {
          if (folder.type === "ARCHIVE") {
            compiledActions.push({ type: "archive" });
          } else if (folder.type === "SPAM") {
            compiledActions.push({ type: "spam" });
          } else if (folder.type === "TRASH") {
            compiledActions.push({ type: "trash" });
          } else if (folder.type === "SENT" || folder.type === "DRAFTS") {
            throw new SieveCompileError(
              `Cannot fileinto the system folder "${folder.name}"`,
              action.token.line,
              action.token.column,
            );
          } else {
            compiledActions.push({ type: "move", folderId: folder.id });
          }
          continue;
        }
        const label = this.options.labels.find(
          (item) => item.name.toLowerCase() === action.folder.toLowerCase(),
        );
        if (label) {
          compiledActions.push({ type: "addLabel", labelIds: [label.id] });
          warnings.push(
            `fileinto "${action.folder}" matched a label, so it was mapped to addLabel.`,
          );
          continue;
        }
        throw new SieveCompileError(
          `Folder or label "${action.folder}" does not exist. Create it first or use the visual editor.`,
          action.token.line,
          action.token.column,
        );
      }
      if (action.kind === "addlabel") {
        const label = this.options.labels.find(
          (item) => item.name.toLowerCase() === action.label.toLowerCase(),
        );
        if (!label) {
          throw new SieveCompileError(
            `Label "${action.label}" does not exist. Create it first or use the visual editor.`,
            action.token.line,
            action.token.column,
          );
        }
        compiledActions.push({ type: "addLabel", labelIds: [label.id] });
        continue;
      }
      if (action.kind === "flag") {
        for (const flag of action.flags) {
          const normalized = flag.toLowerCase();
          if (normalized === "\\seen") {
            if (action.mode === "remove") compiledActions.push({ type: "markUnread" });
            else compiledActions.push({ type: "markRead" });
          } else if (normalized === "\\flagged") {
            if (action.mode === "remove") compiledActions.push({ type: "unstar" });
            else compiledActions.push({ type: "star" });
          } else {
            warnings.push(`Flag "${flag}" is not supported by NyxMail and was ignored.`);
          }
        }
      }
    }

    if (sawKeep) {
      warnings.push("keep is implied by NyxMail's default inbox delivery and was ignored.");
    }
    if (sawCopy) {
      warnings.push("fileinto :copy is treated as a move because NyxMail stores one copy.");
    }
    if (compiledActions.length === 0) {
      throw new SieveCompileError(
        "The filter needs at least one action supported by NyxMail",
        1,
        1,
      );
    }

    return {
      matchType: summary.matchType,
      conditions: summary.conditions,
      expression,
      actions: compiledActions,
      stopProcessing,
      warnings,
      capabilities,
    };
  }

  private findFolder(name: string, token: Token): SieveFolder {
    const folder = this.options.folders.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    if (!folder) {
      throw new SieveCompileError(
        `Folder "${name}" does not exist. Create it first or use the visual editor.`,
        token.line,
        token.column,
      );
    }
    return folder;
  }

  private compileTest(test: TestNode): RuleExpression {
    if (test.kind === "test") {
      return this.compileSimpleTest(test);
    }
    if (test.kind === "not") {
      return negateExpression(this.compileTest(test.test), test.token);
    }
    return {
      kind: test.kind,
      children: test.tests.map((child) => this.compileTest(child)),
    };
  }

  private compileSimpleTest(test: Extract<TestNode, { kind: "test" }>): RuleExpression {
    const name = test.name;
    if (name === "size") {
      const bytes = parseSize(test.number || "0", test.token);
      const operator: RuleOperator = test.tags.includes(":over") ? "greaterThan" : "lessThan";
      return { kind: "condition", field: "size", operator, value: bytes };
    }

    if (name === "environment" || name === "spamtest") {
      throw new SieveCompileError(
        `${name} is only supported as the Proton spam guard at the top of the script`,
        test.token.line,
        test.token.column,
      );
    }

    if (test.tags.includes(":regex")) {
      throw new SieveCompileError(
        ":regex is not supported. Use :matches with * and ? wildcards.",
        test.token.line,
        test.token.column,
      );
    }

    const values = test.values ?? [];
    if (values.length === 0) {
      throw new SieveCompileError("A test needs at least one match value", test.token.line, test.token.column);
    }

    const matchTag =
      test.tags.find((tag) => [":contains", ":is", ":matches"].includes(tag)) || ":is";
    const operator: RuleOperator =
      matchTag === ":contains" ? "contains" : matchTag === ":matches" ? "matchesGlob" : "equals";

    const makeConditions = (
      fields: RuleCondition["field"][],
    ): RuleExpression => {
      const conditions: RuleExpression[] = [];
      for (const field of fields) {
        for (const value of values) {
          conditions.push({ kind: "condition", field, operator, value });
        }
      }
      return conditions.length === 1 ? conditions[0] : { kind: "anyof", children: conditions };
    };

    if (name === "body") {
      return makeConditions(["body"]);
    }

    if (name === "header") {
      const headers = test.headers ?? [];
      if (headers.length === 0) {
        throw new SieveCompileError("header needs at least one header name", test.token.line, test.token.column);
      }
      return makeConditions(headers.map((header) => headerField(header, test.token)));
    }

    if (name === "address") {
      if (test.tags.includes(":localpart")) {
        throw new SieveCompileError(
          "address :localpart is not supported. Use header :contains with the local part.",
          test.token.line,
          test.token.column,
        );
      }
      const headers = test.headers ?? [];
      if (headers.length === 0) {
        throw new SieveCompileError("address needs at least one header name", test.token.line, test.token.column);
      }
      if (test.tags.includes(":domain")) {
        if (!headers.every((header) => ["from", "sender"].includes(header.toLowerCase()))) {
          throw new SieveCompileError(
            "address :domain is only supported for the sender address",
            test.token.line,
            test.token.column,
          );
        }
        return makeConditions(["senderDomain"]);
      }
      return makeConditions(headers.map((header) => headerField(header, test.token)));
    }

    throw new SieveCompileError(
      `Unsupported test "${name}"`,
      test.token.line,
      test.token.column,
    );
  }

}

function negateExpression(expression: RuleExpression, token: Token): RuleExpression {
  if (expression.kind === "condition") {
    const inverse: Partial<Record<RuleOperator, RuleOperator>> = {
      contains: "notContains",
      notContains: "contains",
      equals: "isNot",
      isNot: "equals",
      greaterThan: "lessOrEqual",
      greaterOrEqual: "lessThan",
      lessThan: "greaterOrEqual",
      lessOrEqual: "greaterThan",
    };
    const operator = inverse[expression.operator];
    if (!operator) {
      throw new SieveCompileError(
        `not cannot be applied to the "${expression.operator}" operator`,
        token.line,
        token.column,
      );
    }
    return { ...expression, operator };
  }
  return {
    kind: expression.kind === "allof" ? "anyof" : "allof",
    children: expression.children.map((child) => negateExpression(child, token)),
  };
}

function collectConditions(expression: RuleExpression): RuleCondition[] {
  if (expression.kind === "condition") {
    return [
      {
        field: expression.field,
        operator: expression.operator,
        value: expression.value,
      },
    ];
  }
  return expression.children.flatMap(collectConditions);
}

function summarizeExpression(expression: RuleExpression): {
  matchType: RuleMatchType;
  conditions: RuleCondition[];
} {
  if (expression.kind === "condition") {
    return { matchType: "ALL", conditions: collectConditions(expression) };
  }
  if (expression.children.every((child) => child.kind === "condition")) {
    return {
      matchType: expression.kind === "allof" ? "ALL" : "ANY",
      conditions: expression.children.flatMap(collectConditions),
    };
  }
  // Nested expressions are stored in `expression`; `conditions` is a flat
  // display list for the rule listing and older clients.
  return { matchType: "ALL", conditions: collectConditions(expression) };
}

function headerField(header: string, token: Token): RuleCondition["field"] {
  const normalized = header.trim().toLowerCase();
  if (normalized === "from") return "from";
  if (normalized === "to") return "to";
  if (normalized === "cc") return "cc";
  if (normalized === "bcc") return "bcc";
  if (normalized === "subject") return "subject";
  if (normalized === "delivered-to" || normalized === "x-delivered-to") return "recipient";
  if (normalized === "sender") return "from";
  throw new SieveCompileError(
    `Header "${header}" is not supported. Use From, To, Cc, Subject or Delivered-To.`,
    token.line,
    token.column,
  );
}

function parseSize(value: string, token: Token): number {
  const match = /^(\d+)([KMG])?$/i.exec(value.trim());
  if (!match) {
    throw new SieveCompileError(
      `Invalid size "${value}". Use bytes, K, M or G.`,
      token.line,
      token.column,
    );
  }
  const amount = Number(match[1]);
  const multiplier =
    match[2]?.toUpperCase() === "G"
      ? 1024 ** 3
      : match[2]?.toUpperCase() === "M"
        ? 1024 ** 2
        : match[2]?.toUpperCase() === "K"
          ? 1024
          : 1;
  return amount * multiplier;
}

export function compileSieve(
  script: string,
  options: SieveCompileOptions,
): SieveCompileResult {
  const parser = new Parser(tokenize(script), options);
  return parser.compile();
}
