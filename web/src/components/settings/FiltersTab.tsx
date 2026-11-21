"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Filter,
  ListFilter,
  Pencil,
  Plus,
  Power,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type {
  FolderDTO,
  LabelDTO,
  MailRuleDTO,
  RuleAction,
  RuleActionType,
  RuleCondition,
  RuleExpression,
  RuleField,
  RuleMatchType,
  RuleMode,
  RuleOperator,
} from "@nyxmail/shared";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToast } from "@/lib/client/toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { cn } from "@/lib/client/utils";

const FIELD_OPTIONS: Array<{ value: RuleField; label: string; kind: "text" | "number" | "boolean" | "auth" }> = [
  { value: "from", label: "From", kind: "text" },
  { value: "fromName", label: "From name", kind: "text" },
  { value: "senderDomain", label: "Sender domain", kind: "text" },
  { value: "to", label: "To", kind: "text" },
  { value: "cc", label: "Cc", kind: "text" },
  { value: "bcc", label: "Bcc", kind: "text" },
  { value: "recipient", label: "Delivered-to address", kind: "text" },
  { value: "subject", label: "Subject", kind: "text" },
  { value: "body", label: "Body", kind: "text" },
  { value: "any", label: "Any header or body", kind: "text" },
  { value: "attachmentName", label: "Attachment name", kind: "text" },
  { value: "hasAttachment", label: "Has attachment", kind: "boolean" },
  { value: "size", label: "Message size", kind: "number" },
  { value: "spamScore", label: "Spam score", kind: "number" },
  { value: "spf", label: "SPF result", kind: "auth" },
  { value: "dkim", label: "DKIM result", kind: "auth" },
  { value: "dmarc", label: "DMARC result", kind: "auth" },
];

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  equals: "equals",
  notEquals: "does not equal",
  startsWith: "starts with",
  endsWith: "ends with",
  matchesGlob: "matches pattern",
  is: "is",
  isNot: "is not",
  greaterThan: "is greater than",
  greaterOrEqual: "is at least",
  lessThan: "is less than",
  lessOrEqual: "is at most",
};

const ACTION_OPTIONS: Array<{ value: RuleActionType; label: string }> = [
  { value: "move", label: "Move to folder" },
  { value: "addLabel", label: "Add label" },
  { value: "markRead", label: "Mark as read" },
  { value: "markUnread", label: "Mark as unread" },
  { value: "star", label: "Star" },
  { value: "unstar", label: "Remove star" },
  { value: "archive", label: "Archive" },
  { value: "spam", label: "Move to Spam" },
  { value: "trash", label: "Move to Trash" },
];

function fieldKind(field: RuleField): "text" | "number" | "boolean" | "auth" {
  return FIELD_OPTIONS.find((item) => item.value === field)?.kind ?? "text";
}

function operatorsFor(field: RuleField): RuleOperator[] {
  const kind = fieldKind(field);
  if (kind === "boolean" || kind === "auth") return ["is", "isNot"];
  if (kind === "number") {
    return ["greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "equals", "notEquals"];
  }
  return ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith", "matchesGlob"];
}

function defaultCondition(): RuleCondition {
  return { field: "from", operator: "contains", value: "" };
}

function defaultAction(folders: FolderDTO[], labels: LabelDTO[]): RuleAction {
  const targetFolder =
    folders.find((folder) => folder.type === "CUSTOM") ??
    folders.find((folder) => folder.type === "ARCHIVE") ??
    folders.find((folder) => folder.type === "INBOX");
  const firstLabel = labels[0];
  if (targetFolder) return { type: "move", folderId: targetFolder.id };
  if (firstLabel) return { type: "addLabel", labelIds: [firstLabel.id] };
  return { type: "markRead" };
}

function fieldLabel(field: RuleField): string {
  return FIELD_OPTIONS.find((item) => item.value === field)?.label ?? field;
}

function describeCondition(condition: RuleCondition): string {
  const kind = fieldKind(condition.field);
  if (kind === "boolean") {
    return `${fieldLabel(condition.field)} ${condition.value === true ? "yes" : "no"}`;
  }
  if (condition.field === "size") {
    const mb = Number(condition.value) / 1024 / 1024;
    return `Size ${OPERATOR_LABELS[condition.operator]} ${mb.toFixed(mb >= 1 ? 1 : 2)} MB`;
  }
  return `${fieldLabel(condition.field)} ${OPERATOR_LABELS[condition.operator]} “${String(condition.value)}”`;
}

interface SievePreview {
  matchType: RuleMatchType;
  conditions: RuleCondition[];
  expression?: RuleExpression | null;
  actions: RuleAction[];
  stopProcessing: boolean;
  warnings: string[];
}

function expressionIsNested(expression: RuleExpression | null | undefined): boolean {
  if (!expression || expression.kind === "condition") return false;
  return expression.children.some((child) => child.kind !== "condition");
}

function describeExpression(expression: RuleExpression): string {
  if (expression.kind === "condition") return describeCondition(expression);
  const separator = expression.kind === "allof" ? " AND " : " OR ";
  return `(${expression.children.map(describeExpression).join(separator)})`;
}

const SIEVE_EXAMPLE = `require ["fileinto", "imap4flags"];

if allof (
  header :contains "From" "example.com",
  header :contains "Subject" "invoice"
) {
  fileinto "Archive";
  addflag "\\\\Seen";
}`;

function describeAction(action: RuleAction, folders: FolderDTO[], labels: LabelDTO[]): string {
  if (action.type === "move") {
    return `Move to ${folders.find((folder) => folder.id === action.folderId)?.name ?? "folder"}`;
  }
  if (action.type === "addLabel") {
    const names = (action.labelIds ?? [])
      .map((id) => labels.find((label) => label.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    return `Add label ${names || "label"}`;
  }
  return ACTION_OPTIONS.find((item) => item.value === action.type)?.label ?? action.type;
}

export function FiltersTab() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [rules, setRules] = useState<MailRuleDTO[]>([]);
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [labels, setLabels] = useState<LabelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MailRuleDTO | "new" | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<RuleMode>("VISUAL");
  const [sieveScript, setSieveScript] = useState("");
  const [sievePreview, setSievePreview] = useState<SievePreview | null>(null);
  const [sieveComplex, setSieveComplex] = useState(false);
  const [sieveError, setSieveError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [matchType, setMatchType] = useState<RuleMatchType>("ALL");
  const [stopProcessing, setStopProcessing] = useState(false);
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ruleData, folderData, labelData] = await Promise.all([
        apiFetch<{ rules: MailRuleDTO[] }>("/api/v1/rules"),
        apiFetch<{ folders: FolderDTO[] }>("/api/v1/folders"),
        apiFetch<{ labels: LabelDTO[] }>("/api/v1/labels"),
      ]);
      setRules(ruleData.rules);
      setFolders(folderData.folders);
      setLabels(labelData.labels);
    } catch {
      toast({ title: "Could not load filters", tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const availableFolders = useMemo(
    () => folders.filter((folder) => !["SENT", "DRAFTS"].includes(folder.type)),
    [folders],
  );

  const openEditor = (rule: MailRuleDTO | null) => {
    if (rule) {
      setEditing(rule);
      setName(rule.name);
      setMode(rule.mode);
      setSieveScript(rule.sieveScript ?? "");
      setSievePreview(null);
      setSieveComplex(expressionIsNested(rule.expression));
      setSieveError(null);
      setEnabled(rule.enabled);
      setMatchType(rule.matchType);
      setStopProcessing(rule.stopProcessing);
      setConditions(rule.conditions.map((condition) => ({ ...condition })));
      setActions(
        rule.actions.map((action) => ({
          ...action,
          ...(action.labelIds ? { labelIds: [...action.labelIds] } : {}),
        })),
      );
    } else {
      setEditing("new");
      setName("");
      setMode("VISUAL");
      setSieveScript("");
      setSievePreview(null);
      setSieveComplex(false);
      setSieveError(null);
      setEnabled(true);
      setMatchType("ALL");
      setStopProcessing(false);
      setConditions([defaultCondition()]);
      setActions([defaultAction(availableFolders, labels)]);
    }
  };

  const updateCondition = (index: number, patch: Partial<RuleCondition>) => {
    setConditions((current) =>
      current.map((condition, itemIndex) =>
        itemIndex === index ? { ...condition, ...patch } : condition,
      ),
    );
  };

  const setConditionField = (index: number, field: RuleField) => {
    const kind = fieldKind(field);
    const operators = operatorsFor(field);
    setConditions((current) =>
      current.map((condition, itemIndex) => {
        if (itemIndex !== index) return condition;
        return {
          field,
          operator: operators[0],
          value:
            kind === "boolean"
              ? true
              : kind === "auth"
                ? "fail"
                : kind === "number"
                  ? field === "size"
                    ? 1024 * 1024
                    : 1
                  : "",
        };
      }),
    );
  };

  const updateAction = (index: number, patch: Partial<RuleAction>) => {
    setActions((current) =>
      current.map((action, itemIndex) => (itemIndex === index ? { ...action, ...patch } : action)),
    );
  };

  const validateSieve = async (quiet = false) => {
    if (!sieveScript.trim()) {
      setSieveError("Paste a Sieve script first.");
      return false;
    }
    setValidating(true);
    setSieveError(null);
    try {
      const data = await apiFetch<SievePreview & { ok: boolean }>("/api/v1/rules/sieve/validate", {
        method: "POST",
        body: JSON.stringify({ script: sieveScript }),
      });
      setSievePreview({
        matchType: data.matchType,
        conditions: data.conditions,
        expression: data.expression,
        actions: data.actions,
        stopProcessing: data.stopProcessing,
        warnings: data.warnings,
      });
      setSieveComplex(expressionIsNested(data.expression));
      if (!quiet) {
        toast({ title: "Sieve script is valid", tone: "success" });
      }
      return true;
    } catch (caught) {
      const message =
        caught instanceof ApiClientError ? caught.message : "Could not validate the Sieve script";
      setSievePreview(null);
      setSieveError(message);
      if (!quiet) {
        toast({ title: "Sieve script needs a fix", description: message, tone: "error" });
      }
      return false;
    } finally {
      setValidating(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return toast({ title: "Give the rule a name", tone: "warning" });

    if (mode === "SIEVE") {
      if (!sieveScript.trim()) {
        return toast({ title: "Paste a Sieve script before saving", tone: "warning" });
      }
    } else {
      if (conditions.length === 0) return toast({ title: "Add at least one condition", tone: "warning" });
      if (actions.length === 0) return toast({ title: "Add at least one action", tone: "warning" });
      for (const condition of conditions) {
        if (fieldKind(condition.field) !== "boolean" && String(condition.value).trim() === "") {
          return toast({ title: `Set a value for the ${fieldLabel(condition.field)} condition`, tone: "warning" });
        }
        if (condition.field === "size") {
          const mb = Number(condition.value);
          if (!Number.isFinite(mb) || mb <= 0) {
            return toast({ title: "Size must be greater than zero", tone: "warning" });
          }
        }
      }
      for (const action of actions) {
        if (action.type === "move" && !action.folderId) {
          return toast({ title: "Choose a folder for the move action", tone: "warning" });
        }
        if (action.type === "addLabel" && (!action.labelIds || action.labelIds.length === 0)) {
          return toast({ title: "Choose a label for the label action", tone: "warning" });
        }
      }
    }

    setSaving(true);
    setSieveError(null);
    try {
      const payload =
        mode === "SIEVE"
          ? {
              name: name.trim(),
              enabled,
              mode: "SIEVE" as const,
              sieveScript,
            }
          : {
              name: name.trim(),
              enabled,
              mode: "VISUAL" as const,
              matchType,
              conditions,
              actions,
              stopProcessing,
            };
      const data =
        editing === "new"
          ? await apiFetch<{ rule: MailRuleDTO; warnings?: string[] }>("/api/v1/rules", {
              method: "POST",
              body: JSON.stringify(payload),
            })
          : editing
            ? await apiFetch<{ rule: MailRuleDTO; warnings?: string[] }>(
                `/api/v1/rules/${editing.id}`,
                {
                  method: "PATCH",
                  body: JSON.stringify(payload),
                },
              )
            : null;
      if (!data) return;
      const isNew = editing === "new";
      const editingId = editing && editing !== "new" ? editing.id : null;
      setRules((current) =>
        isNew
          ? [...current, data.rule]
          : current.map((rule) => (rule.id === editingId ? data.rule : rule)),
      );
      const warnings = data.warnings ?? [];
      toast({
        title: isNew ? "Filter created" : "Filter updated",
        description: warnings.length > 0 ? warnings.join(" ") : undefined,
        tone: "success",
      });
      setEditing(null);
    } catch (caught) {
      const message =
        caught instanceof ApiClientError ? caught.message : "Could not save the filter";
      if (mode === "SIEVE") setSieveError(message);
      toast({
        title: "Could not save the filter",
        description: message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: MailRuleDTO) => {
    try {
      const data = await apiFetch<{ rule: MailRuleDTO }>(`/api/v1/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      setRules((current) => current.map((item) => (item.id === rule.id ? data.rule : item)));
    } catch {
      toast({ title: "Could not toggle the filter", tone: "error" });
    }
  };

  const reorder = async (rule: MailRuleDTO, direction: -1 | 1) => {
    const index = rules.findIndex((item) => item.id === rule.id);
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    setRules(next);
    try {
      await apiFetch("/api/v1/rules/reorder", {
        method: "POST",
        body: JSON.stringify({ ids: next.map((item) => item.id) }),
      });
    } catch {
      toast({ title: "Could not reorder filters", tone: "error" });
      void load();
    }
  };

  const remove = async (rule: MailRuleDTO) => {
    await confirm({
      title: `Delete the filter “${rule.name}”?`,
      description: "New mail will stop being sorted by this filter. Existing messages are untouched.",
      confirmLabel: "Delete filter",
      tone: "danger",
      icon: <Trash2 className="h-5 w-5" />,
      details: [{ label: "Filter", value: rule.name }],
      onConfirm: async () => {
        try {
          await apiFetch(`/api/v1/rules/${rule.id}`, { method: "DELETE" });
          setRules((current) => current.filter((item) => item.id !== rule.id));
          toast({ title: "Filter deleted", tone: "success" });
        } catch {
          toast({ title: "Could not delete the filter", tone: "error" });
        }
      },
    });
  };

  return (
    <div className="space-y-5">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Filter className="h-4 w-4 text-accent2" /> Mail filters
            </h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted">
              Sieve-style rules run at incoming server ingress. Use them to move mail into folders,
              add labels, mark messages read, star, archive, mark spam or trash. Rules are evaluated
              in order; the first matching rules can stop further processing.
            </p>
          </div>
          <Button type="button" onClick={() => openEditor(null)} icon={<Plus className="h-4 w-4" />}>
            New filter
          </Button>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-canvas px-3 py-2 text-[10px] leading-relaxed text-faint">
          Filters apply to inbound internet mail, where the server can inspect the content. Messages
          delivered directly between local encrypted mailboxes are already sealed before delivery and
          are not server-filtered.
        </div>
      </section>

      {loading ? (
        <div className="flex justify-center py-12 text-faint">Loading filters…</div>
      ) : rules.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent2">
            <Filter className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">No filters yet</p>
            <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted">
              Create a rule like “senders in @github.com → move to Dev, mark read, add Builds label”.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => openEditor(null)} icon={<Plus className="h-3.5 w-3.5" />}>
            Create your first filter
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div key={rule.id} className={cn("card p-4 transition-opacity", !rule.enabled && "opacity-60")}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5 rounded-md border border-border bg-canvas px-1.5 py-0.5 font-mono text-[9px] text-faint">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-xs font-semibold text-ink">{rule.name}</p>
                    {rule.mode === "SIEVE" && (
                      <span className="chip border-accent/20 bg-accent/[0.06] px-1.5 py-0.5 text-[8.5px] text-accent2">
                        <Code2 className="h-3 w-3" /> Sieve
                      </span>
                    )}
                    {rule.mode === "SIEVE" && expressionIsNested(rule.expression) && (
                      <span className="chip px-1.5 py-0.5 text-[8.5px]">nested logic</span>
                    )}
                    <span className="chip px-1.5 py-0.5 text-[8.5px]">
                      Match {rule.matchType === "ALL" ? "all" : "any"}
                    </span>
                    {rule.stopProcessing && <span className="chip px-1.5 py-0.5 text-[8.5px]">stops</span>}
                  </div>
                  <div className="mt-2 space-y-1">
                    {rule.mode === "SIEVE" && rule.expression && expressionIsNested(rule.expression) ? (
                      <div className="flex items-start gap-2 text-[10.5px] leading-relaxed text-muted">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent2" />
                        <span className="line-clamp-3">{describeExpression(rule.expression)}</span>
                      </div>
                    ) : (
                      rule.conditions.map((condition, conditionIndex) => (
                        <div key={conditionIndex} className="flex items-start gap-2 text-[10.5px] text-muted">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent2" />
                          {describeCondition(condition)}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rule.actions.map((action, actionIndex) => (
                      <span
                        key={actionIndex}
                        className="rounded-full border border-success/20 bg-success/[0.05] px-2 py-0.5 text-[9.5px] text-success"
                      >
                        {describeAction(action, folders, labels)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className={cn("icon-btn h-7 w-7", rule.enabled && "text-success")}
                    onClick={() => void toggleRule(rule)}
                    aria-label={rule.enabled ? "Disable filter" : "Enable filter"}
                    title={rule.enabled ? "Disable" : "Enable"}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn h-7 w-7"
                    onClick={() => void reorder(rule, -1)}
                    disabled={index === 0}
                    aria-label="Move filter up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn h-7 w-7"
                    onClick={() => void reorder(rule, 1)}
                    disabled={index === rules.length - 1}
                    aria-label="Move filter down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn h-7 w-7"
                    onClick={() => openEditor(rule)}
                    aria-label={`Edit ${rule.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn h-7 w-7 hover:text-danger"
                    onClick={() => void remove(rule)}
                    aria-label={`Delete ${rule.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New mail filter" : "Edit mail filter"}
        description={
          mode === "SIEVE"
            ? "Raw Sieve is compiled to the same conditions and actions as the visual editor, then evaluated at inbound mail ingress."
            : "Server-side rules evaluate sender, recipients, subject, body, attachments, size and authentication results."
        }
        width="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="rule-form" loading={saving}>
              Save filter
            </Button>
          </div>
        }
      >
        <form id="rule-form" onSubmit={save} className="space-y-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5">
            <div>
              <p className="text-[11px] font-medium text-ink">Filter editor</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
                Raw Sieve is compiled to the same conditions and actions as the visual editor.
              </p>
            </div>
            <div className="flex rounded-xl border border-border bg-surface p-0.5">
              {([
                ["VISUAL", "Visual", ListFilter],
                ["SIEVE", "Raw Sieve", Code2],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    if (value === "VISUAL" && sieveComplex) {
                      toast({
                        title: "Nested Sieve logic can only be edited as raw text",
                        description: "Use separate filters if you want to edit this rule visually.",
                        tone: "warning",
                      });
                      return;
                    }
                    setMode(value);
                    setSieveError(null);
                    if (value === "VISUAL") setSievePreview(null);
                  }}
                  disabled={value === "VISUAL" && sieveComplex}
                  title={
                    value === "VISUAL" && sieveComplex
                      ? "This filter uses nested anyof/allof logic and must stay in raw Sieve mode"
                      : undefined
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    mode === value ? "bg-accent text-white" : "text-muted hover:text-ink",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Filter name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="GitHub notifications"
            maxLength={100}
            required
          />

          {mode === "VISUAL" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="label mb-0">Match</p>
                <div className="flex rounded-xl border border-border bg-canvas p-0.5">
                  {(["ALL", "ANY"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMatchType(type)}
                      className={cn(
                        "rounded-[9px] px-4 py-1.5 text-[11px] font-medium transition-colors",
                        matchType === type ? "bg-accent text-white" : "text-muted hover:text-ink",
                      )}
                    >
                      {type === "ALL" ? "All conditions" : "Any condition"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="label mb-0">Conditions</p>
                  <button
                    type="button"
                    className="text-[10px] font-medium text-accent2 hover:underline"
                    onClick={() => setConditions((current) => [...current, defaultCondition()])}
                  >
                    + Add condition
                  </button>
                </div>
            <div className="space-y-2">
              {conditions.map((condition, index) => {
                const kind = fieldKind(condition.field);
                const operators = operatorsFor(condition.field);
                return (
                  <div key={index} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-canvas p-2">
                    <Select
                      size="sm"
                      className="min-w-[130px] flex-1"
                      ariaLabel={`Condition ${index + 1} field`}
                      value={condition.field}
                      onChange={(value) => setConditionField(index, value as RuleField)}
                      options={FIELD_OPTIONS.map((field) => ({
                        value: field.value,
                        label: field.label,
                      }))}
                    />
                    <Select
                      size="sm"
                      className="min-w-[130px]"
                      ariaLabel={`Condition ${index + 1} operator`}
                      value={condition.operator}
                      onChange={(value) =>
                        updateCondition(index, { operator: value as RuleOperator })
                      }
                      options={operators.map((operator) => ({
                        value: operator,
                        label: OPERATOR_LABELS[operator],
                      }))}
                    />
                    {kind === "boolean" ? (
                      <Select
                        size="sm"
                        className="w-24"
                        ariaLabel={`Condition ${index + 1} value`}
                        value={condition.value ? "true" : "false"}
                        onChange={(value) => updateCondition(index, { value: value === "true" })}
                        options={[
                          { value: "true", label: "Yes" },
                          { value: "false", label: "No" },
                        ]}
                      />
                    ) : kind === "auth" ? (
                      <Select
                        size="sm"
                        className="w-28"
                        ariaLabel={`Condition ${index + 1} value`}
                        value={String(condition.value || "fail")}
                        onChange={(value) => updateCondition(index, { value })}
                        options={[
                          "pass",
                          "fail",
                          "none",
                          ...(condition.field === "spf" ? ["softfail", "neutral"] : []),
                        ].map((value) => ({ value, label: value }))}
                      />
                    ) : kind === "number" && condition.field === "size" ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0.01"
                          step="0.1"
                          value={
                            Number.isFinite(Number(condition.value))
                              ? Math.max(0.01, Number(condition.value) / 1024 / 1024)
                              : 1
                          }
                          onChange={(event) =>
                            updateCondition(index, {
                              value: Number(event.target.value) * 1024 * 1024,
                            })
                          }
                          className="h-8 w-24 rounded-lg border border-border bg-surface px-2 text-[11px] text-ink outline-none"
                          aria-label={`Condition ${index + 1} size`}
                        />
                        <span className="text-[10px] text-faint">MB</span>
                      </div>
                    ) : (
                      <input
                        value={String(condition.value ?? "")}
                        onChange={(event) =>
                          updateCondition(index, {
                            value:
                              kind === "number" ? Number(event.target.value) : event.target.value,
                          })
                        }
                        type={kind === "number" ? "number" : "text"}
                        placeholder={
                          condition.operator === "matchesGlob" ? "Build * main" : "value"
                        }
                        className="h-8 min-w-[130px] flex-1 rounded-lg border border-border bg-surface px-2 text-[11px] text-ink placeholder:text-faint outline-none"
                        aria-label={`Condition ${index + 1} value`}
                      />
                    )}
                    <button
                      type="button"
                      className="icon-btn h-8 w-8 hover:text-danger"
                      onClick={() => setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      disabled={conditions.length === 1}
                      aria-label="Remove condition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label mb-0">Actions</p>
              <button
                type="button"
                className="text-[10px] font-medium text-accent2 hover:underline"
                onClick={() => setActions((current) => [...current, defaultAction(availableFolders, labels)])}
              >
                + Add action
              </button>
            </div>
            <div className="space-y-2">
              {actions.map((action, index) => (
                <div key={index} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-canvas p-2">
                  <Select
                    size="sm"
                    className="min-w-[150px] flex-1"
                    ariaLabel={`Action ${index + 1} type`}
                    value={action.type}
                    onChange={(value) => {
                      const type = value as RuleActionType;
                      updateAction(index, {
                        type,
                        folderId: type === "move" ? availableFolders[0]?.id : undefined,
                        labelIds: type === "addLabel" && labels[0] ? [labels[0].id] : undefined,
                      });
                    }}
                    options={ACTION_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                  {action.type === "move" && (
                    <Select
                      size="sm"
                      className="min-w-[150px]"
                      ariaLabel={`Action ${index + 1} folder`}
                      value={action.folderId ?? ""}
                      onChange={(value) => updateAction(index, { folderId: value })}
                      placeholder="Choose folder"
                      options={availableFolders.map((folder) => ({
                        value: folder.id,
                        label: folder.name,
                      }))}
                    />
                  )}
                  {action.type === "addLabel" && (
                    <Select
                      size="sm"
                      className="min-w-[150px]"
                      ariaLabel={`Action ${index + 1} label`}
                      value={action.labelIds?.[0] ?? ""}
                      onChange={(value) =>
                        updateAction(index, { labelIds: value ? [value] : [] })
                      }
                      placeholder="No labels yet"
                      disabled={labels.length === 0}
                      options={labels.map((label) => ({ value: label.id, label: label.name }))}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-btn h-8 w-8 hover:text-danger"
                    onClick={() => setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    disabled={actions.length === 1}
                    aria-label="Remove action"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-faint">
              Folder actions run in the order shown; the last folder action wins.
            </p>
          </div>
            </>
          )}

          {mode === "SIEVE" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-canvas p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-ink">Raw Sieve script</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
                      One <code className="font-mono">if</code> block per filter. Comments and{" "}
                      <code className="font-mono">require</code> are allowed.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSieveScript(SIEVE_EXAMPLE);
                        setSievePreview(null);
                        setSieveError(null);
                      }}
                      icon={<Code2 className="h-3.5 w-3.5" />}
                    >
                      Use example
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void validateSieve()}
                      loading={validating}
                    >
                      Validate
                    </Button>
                  </div>
                </div>
                <textarea
                  value={sieveScript}
                  onChange={(event) => {
                    setSieveScript(event.target.value);
                    setSievePreview(null);
                    setSieveError(null);
                  }}
                  rows={16}
                  spellCheck={false}
                  aria-label="Raw Sieve script"
                  placeholder={`require ["fileinto", "imap4flags"];

if allof (
  header :contains "From" "github.com",
  header :contains "Subject" "[build]"
) {
  fileinto "Dev";
  addflag "\\\\Seen";
  stop;
}`}
                  className="mt-3 w-full resize-y rounded-xl border border-border bg-[#07090D] p-3 font-mono text-[11px] leading-6 text-white/80 outline-none placeholder:text-white/20 focus:border-accent/50"
                />
                <p className="mt-2 text-[9px] leading-relaxed text-faint">
                  Supported: header/address/body/size tests, allof/anyof/not, fileinto, addlabel,
                  addflag/setflag/removeflag and stop. Use separate filters for elsif/else or
                  mixed nested groups.
                </p>
              </div>

              {sieveError && (
                <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-[10.5px] leading-relaxed text-danger">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {sieveError}
                </div>
              )}

              {sievePreview && (
                <div className="rounded-xl border border-success/20 bg-success/[0.04] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-success">
                      Compiled preview
                    </p>
                    <span className="chip px-1.5 py-0.5 text-[8px]">
                      Match {sievePreview.matchType === "ALL" ? "all" : "any"}
                    </span>
                    {sievePreview.stopProcessing && (
                      <span className="chip px-1.5 py-0.5 text-[8px]">stops later filters</span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    {sievePreview.conditions.map((condition, index) => (
                      <div key={index} className="flex items-start gap-2 text-[10.5px] text-muted">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent2" />
                        {describeCondition(condition)}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sievePreview.actions.map((action, index) => (
                      <span
                        key={index}
                        className="rounded-full border border-success/20 bg-success/[0.06] px-2 py-0.5 text-[9.5px] text-success"
                      >
                        {describeAction(action, folders, labels)}
                      </span>
                    ))}
                  </div>
                  {sievePreview.warnings.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[9.5px] leading-relaxed text-warning">
                      {sievePreview.warnings.map((warning) => (
                        <li key={warning}>• {warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5">
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-3.5 w-3.5 accent-[#6D4AFF]"
              />
              Enable this filter
            </label>
            {mode === "VISUAL" ? (
              <label className="flex items-center gap-2 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={stopProcessing}
                  onChange={(event) => setStopProcessing(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#6D4AFF]"
                />
                Stop processing later filters
              </label>
            ) : (
              <span className="text-[9.5px] text-faint">
                Add <code className="font-mono">stop;</code> inside the script to stop later filters.
              </span>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
