"use client";

import { Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { issueFieldsApi } from "@/api/tracker/issue-fields.api";
import {
  formatIssueFieldValue,
  ISSUE_FIELD_TYPE_LABELS,
  ISSUE_FIELD_TYPES,
  type IssueFieldDef,
  type IssueFieldType,
} from "@/domain/tracker";
import {
  useIssueFieldDefs,
  useIssueFieldValues,
} from "@/hooks/tracker/useIssueFields";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";

const OPTION_TYPES: IssueFieldType[] = [
  "status",
  "selectSingle",
  "selectMulti",
];

export interface IssueCustomFieldsProps {
  orgId: string;
  issueId: string;
  projectId: string;
}

export function IssueCustomFields({
  orgId,
  issueId,
  projectId,
}: IssueCustomFieldsProps) {
  const {
    defs,
    isLoading: defsLoading,
    mutate: mutateDefs,
  } = useIssueFieldDefs(orgId, projectId);
  const {
    values,
    isLoading: valuesLoading,
    mutate: mutateValues,
  } = useIssueFieldValues(orgId, issueId);
  const [managing, setManaging] = useState(false);

  const valueByField = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const v of values) m.set(v.fieldId, v.value);
    return m;
  }, [values]);

  const activeDefs = defs.filter((d) => d.archivedAt === null);

  if (defsLoading || valuesLoading) {
    return (
      <div className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-fg-tertiary">
          Поля
        </span>
        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Settings2 size={13} />
          {managing ? "Готово" : "Настроить поля"}
        </button>
      </div>

      {activeDefs.length === 0 ? (
        <span className="text-xs text-fg-tertiary">
          Кастом-полей пока нет. Нажмите «Настроить поля», чтобы добавить.
        </span>
      ) : (
        <div className="flex flex-col gap-2.5">
          {activeDefs.map((def) => (
            <FieldRow
              key={def.id}
              orgId={orgId}
              issueId={issueId}
              def={def}
              value={valueByField.get(def.id)}
              onChanged={() => void mutateValues()}
            />
          ))}
        </div>
      )}

      {managing ? (
        <ManageDefs
          orgId={orgId}
          projectId={projectId}
          defs={defs}
          onChanged={() => void mutateDefs()}
        />
      ) : null}
    </div>
  );
}

function FieldRow({
  orgId,
  issueId,
  def,
  value,
  onChanged,
}: {
  orgId: string;
  issueId: string;
  def: IssueFieldDef;
  value: unknown;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 truncate text-xs text-fg-tertiary">
        {def.name}
      </span>
      <span className="min-w-0 flex-1">
        {editing ? (
          <FieldEditor
            orgId={orgId}
            issueId={issueId}
            def={def}
            value={value}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-left text-fg-primary hover:text-accent"
          >
            {formatIssueFieldValue(def, value)}
          </button>
        )}
      </span>
    </div>
  );
}

function FieldEditor({
  orgId,
  issueId,
  def,
  value,
  onDone,
  onCancel,
}: {
  orgId: string;
  issueId: string;
  def: IssueFieldDef;
  value: unknown;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<unknown>(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const normalized = normalizeDraft(def.type, draft);
      await issueFieldsApi.setValue(orgId, issueId, {
        fieldId: def.id,
        value: normalized,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }, [busy, def.id, def.type, draft, issueId, onDone, orgId]);

  const options = def.config.options ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      {def.type === "checkbox" ? (
        <label className="flex items-center gap-2 text-fg-primary">
          <input
            type="checkbox"
            checked={draft === true}
            onChange={(e) => setDraft(e.target.checked)}
            disabled={busy}
          />
          {draft === true ? "Да" : "Нет"}
        </label>
      ) : def.type === "status" || def.type === "selectSingle" ? (
        <select
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          className="rounded border border-border-subtle bg-bg-card px-2 py-1 text-fg-primary"
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : def.type === "selectMulti" ? (
        <div className="flex flex-col gap-1">
          {options.map((o) => {
            const arr = Array.isArray(draft) ? (draft as string[]) : [];
            const checked = arr.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex items-center gap-2 text-fg-primary"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arr, o.id]
                      : arr.filter((x) => x !== o.id);
                    setDraft(next);
                  }}
                />
                {o.name}
              </label>
            );
          })}
        </div>
      ) : (
        <Input
          type={
            def.type === "number"
              ? "number"
              : def.type === "date"
                ? "date"
                : def.type === "url"
                  ? "url"
                  : "text"
          }
          value={
            typeof draft === "string"
              ? draft
              : typeof draft === "number"
                ? String(draft)
                : ""
          }
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          className="h-8"
        />
      )}
      {err ? <span className="text-[10px] text-danger">{err}</span> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : "Сохранить"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function normalizeDraft(type: IssueFieldType, draft: unknown): unknown {
  if (type === "checkbox") return draft === true;
  if (type === "selectMulti") return Array.isArray(draft) ? draft : [];
  if (type === "number") {
    if (draft === "" || draft === null || draft === undefined) return null;
    const n = Number(draft);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof draft === "string") {
    return draft.trim() === "" ? null : draft.trim();
  }
  return draft ?? null;
}

function ManageDefs({
  orgId,
  projectId,
  defs,
  onChanged,
}: {
  orgId: string;
  projectId: string;
  defs: IssueFieldDef[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<IssueFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [scopeProject, setScopeProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsOptions = OPTION_TYPES.includes(type);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const options = needsOptions
        ? optionsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((label) => ({
              id: label.toLowerCase().replace(/\s+/g, "_"),
              name: label,
            }))
        : undefined;
      if (needsOptions && (options?.length ?? 0) === 0) {
        setErr("Укажите опции через запятую");
        setBusy(false);
        return;
      }
      await issueFieldsApi.createDef(orgId, {
        name: trimmed,
        type,
        projectId: scopeProject ? projectId : null,
        ...(options ? { config: { options } } : {}),
      });
      setName("");
      setOptionsText("");
      setType("text");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать поле");
    } finally {
      setBusy(false);
    }
  }, [busy, name, needsOptions, onChanged, optionsText, orgId, projectId, scopeProject, type]);

  const archive = useCallback(
    async (id: string) => {
      try {
        await issueFieldsApi.archiveDef(orgId, id);
        onChanged();
      } catch {
        /* ignore */
      }
    },
    [onChanged, orgId],
  );

  return (
    <div className="mt-1 flex flex-col gap-3 border-t border-border-subtle pt-3">
      <div className="flex flex-col gap-2">
        {defs
          .filter((d) => d.archivedAt === null)
          .map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate text-fg-secondary">
                {d.name}
                <span className="ml-1 text-fg-tertiary">
                  ({ISSUE_FIELD_TYPE_LABELS[d.type]}
                  {d.projectId === null ? ", вся компания" : ""})
                </span>
              </span>
              <button
                type="button"
                onClick={() => void archive(d.id)}
                className="shrink-0 text-fg-tertiary hover:text-danger"
                aria-label="Архивировать поле"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-card p-3">
        <span className="text-xs font-medium text-fg-secondary">
          Новое поле
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название поля"
          disabled={busy}
          className="h-8"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as IssueFieldType)}
          disabled={busy}
          className="rounded border border-border-subtle bg-bg-card px-2 py-1 text-fg-primary"
        >
          {ISSUE_FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {ISSUE_FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {needsOptions ? (
          <Input
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder="Опции через запятую: Низкий, Средний, Высокий"
            disabled={busy}
            className="h-8"
          />
        ) : null}
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={scopeProject}
            onChange={(e) => setScopeProject(e.target.checked)}
            disabled={busy}
          />
          Только для этого проекта
        </label>
        {err ? <span className="text-[10px] text-danger">{err}</span> : null}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => void create()}
            disabled={busy || name.trim().length === 0}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Добавить поле
          </Button>
        </div>
      </div>
    </div>
  );
}
