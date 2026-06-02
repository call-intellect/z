'use client';

/**
 * Smart-tables auto-creation (Фаза 4) — диалог «Из файла».
 *
 * Шаг 1: drag&drop / выбор Excel/CSV → анализ
 *   (`tablesApi.importAnalyze`, multipart).
 * Шаг 2: превью инферренной схемы (иконка/название/колонки + лейблы типов),
 *   счётчик распознанных строк, блок кандидатов на слияние; действия
 *   «Создать новую таблицу» / «Слить с …» (`tablesApi.importCommit`).
 *
 * Drag&drop повторяет паттерн `UploadDocumentDialog` из
 * `documents/DocumentsListClient.tsx`. Превью схемы — компактный read-only
 * рендер (правка схемы здесь не нужна: режим create/merge, а не from-schema).
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CloudUpload, GitMerge, Loader2, Table2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { tablesApi } from '@/api/tables.api';
import {
  ENTITY_SYNC_LABEL_RU,
  PROP_TYPE_LABEL_RU,
  type ImportAnalyzeResult,
  type ImportMergeCandidate,
} from '@/domain/table';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';

const ACCEPT = '.xlsx,.xls,.csv';

export function ImportFromFileDialog({
  orgId,
  onClose,
}: {
  orgId: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportAnalyzeResult | null>(null);

  const busy = analyzing || committing;

  const analyze = useCallback(async () => {
    if (!file || busy) return;
    setAnalyzing(true);
    try {
      const res = await tablesApi.importAnalyze(orgId, file);
      setResult(res);
    } catch (e) {
      toast.error(messageForAnalyzeError(e));
    } finally {
      setAnalyzing(false);
    }
  }, [busy, file, orgId]);

  const commit = useCallback(
    async (mode: 'create' | 'merge', targetTableId?: string) => {
      if (!result || busy) return;
      setCommitting(true);
      try {
        const res = await tablesApi.importCommit(orgId, {
          mode,
          targetTableId,
          schema: result.schema,
          rows: result.rows,
        });
        const parts = [`Импортировано строк: ${res.rowsCreated}`];
        if (res.entitiesLinked > 0) {
          parts.push(`связано с памятью: ${res.entitiesLinked}`);
        }
        toast.success(parts.join(', '));
        onClose();
        router.push(`/tables/${res.tableId}`);
      } catch (e) {
        toast.error(
          e instanceof ApiError ? e.message : 'Не удалось импортировать файл.',
        );
      } finally {
        setCommitting(false);
      }
    },
    [busy, onClose, orgId, result, router],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {result ? 'Проверьте таблицу перед созданием' : 'Импорт из файла'}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <AnalyzeResultStep result={result} />
        ) : (
          <UploadStep
            file={file}
            dragOver={dragOver}
            setDragOver={setDragOver}
            onPick={setFile}
          />
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Отменить
              </Button>
              {result.mergeCandidates.length > 0 ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void commit('merge', result.mergeCandidates[0].tableId)
                  }
                >
                  {committing ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <GitMerge size={14} className="mr-1" />
                  )}
                  Слить с «{result.mergeCandidates[0].name}»
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => void commit('create')}>
                {committing ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : null}
                Создать новую таблицу
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Отменить
              </Button>
              <Button disabled={!file || busy} onClick={() => void analyze()}>
                {analyzing ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : null}
                Загрузить и проанализировать
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Шаг 1: загрузка ────────────────────────────

function UploadStep({
  file,
  dragOver,
  setDragOver,
  onPick,
}: {
  file: File | null;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onPick: (f: File | null) => void;
}) {
  return (
    <div className="space-y-3">
      <label
        htmlFor="table-import-upload"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm transition-colors ${
          dragOver
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary'
        }`}
      >
        <CloudUpload size={16} />
        {file
          ? `Выбран файл: ${file.name}`
          : 'Перетащите файл или нажмите, чтобы выбрать'}
        <input
          id="table-import-upload"
          type="file"
          className="hidden"
          accept={ACCEPT}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className="text-xs text-fg-tertiary">
        Поддерживаются таблицы Excel (.xlsx, .xls) и CSV. Кора распознает
        колонки, типы данных и предложит, к чему привязать строки.
      </p>
    </div>
  );
}

// ─────────────────────────── Шаг 2: превью схемы ─────────────────────────

/** Сколько строк показываем в превью (в DOM), не больше. Импортируются все. */
const PREVIEW_DISPLAY_LIMIT = 200;

function AnalyzeResultStep({ result }: { result: ImportAnalyzeResult }) {
  const { schema, rawRowsCount, truncatedColumns, rows, mergeCandidates } = result;

  const entityLabel = useMemo(
    () => (schema.entitySync ? ENTITY_SYNC_LABEL_RU[schema.entitySync.type] : null),
    [schema.entitySync],
  );

  // Честный счётчик: распознано всего vs реально импортируется (в пределах
  // лимита импорта) vs показано в превью.
  let rowsLine = `Распознано строк: ${rawRowsCount}`;
  if (rawRowsCount > rows.length) {
    rowsLine += ` (импортируется первые ${rows.length} — превышен лимит импорта)`;
  } else if (rows.length > PREVIEW_DISPLAY_LIMIT) {
    rowsLine += ` (в превью показаны первые ${PREVIEW_DISPLAY_LIMIT})`;
  }

  return (
    <div className="space-y-3">
      {/* Превью схемы */}
      <div className="rounded-md border border-border-subtle bg-bg-card p-3">
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

        <ul className="mt-3 space-y-1.5">
          {schema.properties.map((p, idx) => (
            <li
              key={idx}
              className="rounded-md border border-border-subtle/60 bg-bg-overlay px-2.5 py-2"
            >
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
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-fg-secondary">{rowsLine}</p>
        {truncatedColumns ? (
          <p className="mt-1 text-xs text-chip-warning-fg">
            В файле больше 50 колонок — лишние столбцы отброшены.
          </p>
        ) : null}
      </div>

      {/* Блок слияния */}
      {mergeCandidates.length > 0 ? (
        <MergeBlock candidates={mergeCandidates} />
      ) : null}
    </div>
  );
}

function MergeBlock({ candidates }: { candidates: ImportMergeCandidate[] }) {
  const top = candidates[0];
  const rest = candidates.slice(1);

  return (
    <div className="rounded-md border border-chip-info-fg/30 bg-chip-info-bg/40 p-3">
      <p className="text-xs text-fg-primary">
        Похоже на существующую таблицу: «{top.name}» (
        {Math.round(top.cosine * 100)}% совпадения). Можно влить строки в неё
        вместо создания новой — кнопка «Слить с «{top.name}»» ниже.
      </p>
      {rest.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {rest.map((c) => (
            <li key={c.tableId} className="text-[11px] text-fg-tertiary">
              Также похоже: «{c.name}» ({Math.round(c.cosine * 100)}%)
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ─────────────────────────── ошибки анализа ─────────────────────────────

function messageForAnalyzeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'unsupported_file_format') {
      return 'Этот формат пока не поддерживается. PDF и сканы появятся позже — загрузите Excel (.xlsx, .xls) или CSV.';
    }
    return e.message;
  }
  return 'Не удалось проанализировать файл.';
}
