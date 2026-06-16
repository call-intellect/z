"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, Table2, Trash2 } from "lucide-react";

import {
  ENTITY_SYNC_LABEL_RU,
  FAZA1_CREATABLE_TYPES,
  PROP_TYPE_LABEL_RU,
  type InferredSchemaProperty,
  type InferredTableSchema,
  type TablePropType,
} from "@/domain/table";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";

export interface TableSchemaPreviewProps {
  schema: InferredTableSchema;
  onConfirm: (schema: InferredTableSchema) => void;
  busy?: boolean;
}

function normalizePrimary(
  props: InferredSchemaProperty[],
): InferredSchemaProperty[] {
  if (props.length === 0) return props;
  const primaryIdx = props.findIndex((p) => p.isPrimary);
  const chosen = primaryIdx >= 0 ? primaryIdx : 0;
  return props.map((p, i) => ({ ...p, isPrimary: i === chosen }));
}

export function TableSchemaPreview({
  schema,
  onConfirm,
  busy = false,
}: TableSchemaPreviewProps) {
  const [editing, setEditing] = useState(false);
  const [props, setProps] = useState<InferredSchemaProperty[]>(() =>
    normalizePrimary(schema.properties),
  );

  const entityLabel = useMemo(
    () =>
      schema.entitySync ? ENTITY_SYNC_LABEL_RU[schema.entitySync.type] : null,
    [schema.entitySync],
  );

  const canConfirm = props.length > 0 && props.some((p) => p.isPrimary);

  const renameProp = useCallback((idx: number, name: string) => {
    setProps((prev) => prev.map((p, i) => (i === idx ? { ...p, name } : p)));
  }, []);

  const changeType = useCallback((idx: number, type: TablePropType) => {
    setProps((prev) => prev.map((p, i) => (i === idx ? { ...p, type } : p)));
  }, []);

  const setPrimary = useCallback((idx: number) => {
    setProps((prev) => prev.map((p, i) => ({ ...p, isPrimary: i === idx })));
  }, []);

  const removeProp = useCallback((idx: number) => {
    setProps((prev) => normalizePrimary(prev.filter((_, i) => i !== idx)));
  }, []);

  const addProp = useCallback(() => {
    setProps((prev) => [
      ...prev,
      { name: "Новая колонка", type: "text", isPrimary: prev.length === 0 },
    ]);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!canConfirm || busy) return;
    onConfirm({ ...schema, properties: normalizePrimary(props) });
  }, [busy, canConfirm, onConfirm, props, schema]);

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      {}
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
          {schema.icon ? (
            <span className="text-base leading-none" aria-hidden>
              {schema.icon}
            </span>
          ) : (
            <Table2 className="h-4 w-4" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg-primary">
            {schema.name}
          </div>
          {schema.description ? (
            <div className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">
              {schema.description}
            </div>
          ) : null}
          {entityLabel ? (
            <div className="mt-1.5">
              <span className="inline-flex items-center rounded-full bg-chip-info-bg px-2 py-0.5 text-[11px] font-medium text-chip-info-fg">
                Привязка к памяти: {entityLabel}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {}
      <ul className="mt-3 space-y-1.5">
        {props.map((p, idx) => (
          <li
            key={idx}
            className="rounded-md border border-border-subtle/60 bg-bg-overlay px-2.5 py-2"
          >
            {editing ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={p.name}
                    onChange={(e) => renameProp(idx, e.target.value)}
                    placeholder="Название колонки"
                    className="h-8 flex-1 text-xs"
                    aria-label="Название колонки"
                  />
                  <button
                    type="button"
                    aria-label="Удалить колонку"
                    onClick={() => removeProp(idx)}
                    disabled={props.length <= 1}
                    className="rounded p-1.5 text-fg-tertiary hover:bg-bg-card hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={p.type}
                    onChange={(e) =>
                      changeType(idx, e.target.value as TablePropType)
                    }
                    aria-label="Тип колонки"
                    className="h-8 flex-1 rounded-md border border-border-subtle bg-bg-card px-2 text-xs text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {FAZA1_CREATABLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PROP_TYPE_LABEL_RU[t]}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-fg-secondary">
                    <input
                      type="radio"
                      name="primary-prop"
                      checked={p.isPrimary}
                      onChange={() => setPrimary(idx)}
                      className="accent-accent"
                    />
                    Ключевая
                  </label>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-fg-primary">
                  {p.name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11px] text-fg-tertiary">
                    {PROP_TYPE_LABEL_RU[p.type]}
                  </span>
                  {p.isPrimary ? (
                    <span className="inline-flex items-center rounded-full bg-chip-success-bg px-2 py-0.5 text-[10px] font-medium text-chip-success-fg">
                      Ключевая
                    </span>
                  ) : null}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing ? (
        <button
          type="button"
          onClick={addProp}
          className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent hover:bg-accent-muted"
        >
          <Plus size={14} />
          Добавить колонку
        </button>
      ) : null}

      {}
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleConfirm}
          disabled={busy || !canConfirm}
        >
          {busy ? "Создаём…" : "Подтвердить и создать"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setEditing((v) => !v)}
          disabled={busy}
        >
          {editing ? "Готово" : "Изменить"}
        </Button>
      </div>
      {!canConfirm ? (
        <p className="mt-1.5 text-[11px] text-fg-tertiary">
          Нужна хотя бы одна колонка и ровно одна ключевая.
        </p>
      ) : null}
    </div>
  );
}
