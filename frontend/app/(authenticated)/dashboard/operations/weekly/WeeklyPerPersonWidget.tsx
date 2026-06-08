'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { weeklyPerPersonApi } from '@/api/weekly-per-person.api';
import {
  pluralRu,
  reliabilityDisplay,
  weeklyPerPersonFromApi,
  type WeeklyPerPersonUi,
  type WeeklyPersonRowUi,
} from '@/domain/weekly-per-person';
import {
  CardTitle,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-D Фаза 5 (2026-06-05) — виджет недельного план-факта по людям.
 *
 * Встроен в «Недельную сводку», но грузит данные САМ и независимо от дайджеста
 * (`GET /api/v1/dashboard/operations/weekly-per-person`). Показывает две
 * колонки: «Держат слово» (надёжные) и «Зоны риска» (срывы/просрочки), плюс
 * drill-down «Показать всех» с полным списком людей за неделю.
 *
 * Инварианты: парные токены chip-*-bg/-fg, весь текст по-русски, без финансов.
 */
export function WeeklyPerPersonWidget({ weekStart }: { weekStart: string }) {
  const [data, setData] = useState<WeeklyPerPersonUi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Drill-down: полный список людей за неделю (загружается по запросу).
  const [allRows, setAllRows] = useState<WeeklyPersonRowUi[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // При смене недели сбрасываем drill-down — данные устарели.
    setExpanded(false);
    setAllRows(null);
    setAllError(null);
    weeklyPerPersonApi
      .get(weekStart, { sort: 'reliability' })
      .then((res) => {
        if (cancelled) return;
        setData(weeklyPerPersonFromApi(res));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(toMessage(err, 'Не удалось загрузить план-факт по людям'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const loadAll = () => {
    setAllLoading(true);
    setAllError(null);
    weeklyPerPersonApi
      .get(weekStart, { limit: 100, offset: 0, sort: 'reliability' })
      .then((res) => {
        setAllRows(weeklyPerPersonFromApi(res).rows);
        setExpanded(true);
      })
      .catch((err: unknown) => {
        setAllError(toMessage(err, 'Не удалось загрузить полный список'));
      })
      .finally(() => {
        setAllLoading(false);
      });
  };

  return (
    <GlassCard>
      <CardTitle icon={<Users size={16} />} grad={GRAD.blue}>
        Кто держит слово — за неделю
      </CardTitle>
      <p className="mt-1 text-sm text-fg-secondary">
        План-факт по людям: обещания, задачи и чек-ины за неделю.
      </p>

      {loading ? (
        <p className="mt-3 rounded border bg-bg-subtle p-4 text-sm text-fg-secondary">
          Загрузка…
        </p>
      ) : error ? (
        <p className="mt-3 rounded border border-chip-warning-bg bg-chip-warning-bg p-4 text-sm text-chip-warning-fg">
          {error}
        </p>
      ) : !data || data.total === 0 ? (
        <p className="mt-3 rounded border bg-bg-subtle p-4 text-sm text-fg-secondary">
          За эту неделю ещё нет данных по людям — обещания, задачи и чек-ины
          появятся по мере работы команды.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ReliableColumn rows={data.topReliable} />
            <RiskColumn rows={data.topRisk} />
          </div>

          <div className="mt-4 border-t border-border-subtle pt-3">
            {!expanded ? (
              <button
                type="button"
                onClick={loadAll}
                disabled={allLoading}
                className="rounded border px-3 py-1 text-sm text-fg-primary hover:bg-bg-subtle disabled:opacity-50"
              >
                {allLoading ? 'Загрузка…' : 'Показать всех'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded border px-3 py-1 text-sm text-fg-primary hover:bg-bg-subtle"
              >
                Свернуть
              </button>
            )}
            {allError ? (
              <p className="mt-3 rounded border border-chip-warning-bg bg-chip-warning-bg p-3 text-sm text-chip-warning-fg">
                {allError}
              </p>
            ) : null}
            {expanded && !allError ? (
              <AllRowsTable rows={allRows ?? []} />
            ) : null}
          </div>
        </>
      )}
    </GlassCard>
  );
}

/* ── Колонка «Держат слово» (тон success) ─────────────────────────────── */
function ReliableColumn({ rows }: { rows: WeeklyPersonRowUi[] }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          aria-hidden
          className="rounded bg-chip-success-bg px-2 py-0.5 text-xs text-chip-success-fg"
        >
          ✓
        </span>
        <h3 className="text-sm font-semibold text-fg-primary">Держат слово</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Пока некого выделить — обещания за неделю не закрыты.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <PersonRow key={r.personId} row={r} tone="success" />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Колонка «Зоны риска» (тон danger/warning) ────────────────────────── */
function RiskColumn({ rows }: { rows: WeeklyPersonRowUi[] }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          aria-hidden
          className="rounded bg-chip-danger-bg px-2 py-0.5 text-xs text-chip-danger-fg"
        >
          !
        </span>
        <h3 className="text-sm font-semibold text-fg-primary">Зоны риска</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Срывов и просрочек за неделю не видно.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <PersonRow key={r.personId} row={r} tone="danger" />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Карточка одного человека ─────────────────────────────────────────── */
function PersonRow({
  row,
  tone,
}: {
  row: WeeklyPersonRowUi;
  tone: 'success' | 'danger';
}) {
  const toneChip =
    tone === 'success'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : 'bg-chip-danger-bg text-chip-danger-fg';
  const broken = row.promisesBroken + row.promisesOverdue;
  const reliability = reliabilityDisplay(row);
  // «мало данных» — приглушённый предупреждающий тон (не фейковые 100%);
  // «—» — нейтральный; процент — тон колонки (success/danger).
  const reliabilityChip =
    reliability.kind === 'low_data'
      ? 'bg-chip-warning-bg text-chip-warning-fg'
      : reliability.kind === 'none'
      ? 'bg-bg-subtle text-fg-tertiary'
      : toneChip;
  const reliabilityTitle =
    reliability.kind === 'low_data'
      ? 'Слишком мало обещаний за неделю, чтобы считать надёжность.'
      : 'Надёжность: доля сдержанных обещаний за неделю';
  return (
    <li className="rounded-md bg-bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg-primary">{row.personName}</span>
        {row.departmentName ? (
          <span className="text-xs text-fg-tertiary">
            · {row.departmentName}
          </span>
        ) : null}
        <span
          className={`ml-auto rounded px-2 py-0.5 text-[11px] tabular-nums ${reliabilityChip}`}
          title={reliabilityTitle}
        >
          {reliability.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-fg-secondary">
        {tone === 'success' ? (
          <>
            Сдержал {row.promisesKept} из {row.promisesGiven}{' '}
            {pluralRu(row.promisesGiven, [
              'обещания',
              'обещаний',
              'обещаний',
            ])}
            .
          </>
        ) : broken > 0 ? (
          <>
            {row.promisesOverdue > 0
              ? `Просрочил ${row.promisesOverdue}`
              : `Сорвал ${row.promisesBroken}`}{' '}
            из {row.promisesGiven}{' '}
            {pluralRu(row.promisesGiven, [
              'обещания',
              'обещаний',
              'обещаний',
            ])}
            .
          </>
        ) : (
          <>Дал {row.promisesGiven}, но ещё не закрыл.</>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-fg-tertiary">
        Задачи: {row.tasksDone} · Чек-ины: {row.checkInsCompleted}
      </p>
    </li>
  );
}

/* ── Полный список (drill-down) ───────────────────────────────────────── */
function AllRowsTable({ rows }: { rows: WeeklyPersonRowUi[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 rounded border bg-bg-subtle p-4 text-sm text-fg-secondary">
        За эту неделю ещё нет данных по людям.
      </p>
    );
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-fg-tertiary">
            <th className="py-2 pr-3 font-medium">Человек</th>
            <th className="py-2 pr-3 font-medium">Отдел</th>
            <th className="py-2 pr-3 text-right font-medium">Дал</th>
            <th className="py-2 pr-3 text-right font-medium">Сдержал</th>
            <th className="py-2 pr-3 text-right font-medium">Просрочил</th>
            <th className="py-2 pr-3 text-right font-medium">Задачи</th>
            <th className="py-2 pr-3 text-right font-medium">Чек-ины</th>
            <th className="py-2 pr-3 text-right font-medium">Надёжность</th>
            <th
              className="py-2 text-right font-medium"
              title="Обещания со статусом „спросили“, на которые ещё нет ответа"
            >
              Без ответа
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const reliability = reliabilityDisplay(r);
            return (
              <tr
                key={r.personId}
                className="border-b border-border-subtle/50 hover:bg-bg-subtle"
              >
                <td className="py-2 pr-3 font-medium text-fg-primary">
                  {r.personName}
                </td>
                <td className="py-2 pr-3 text-fg-secondary">
                  {r.departmentName ?? '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                  {r.promisesGiven}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                  {r.promisesKept}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                  {r.promisesOverdue}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                  {r.tasksDone}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                  {r.checkInsCompleted}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {reliability.kind === 'low_data' ? (
                    <span
                      className="rounded bg-chip-warning-bg px-2 py-0.5 text-[11px] text-chip-warning-fg"
                      title="Слишком мало обещаний за неделю, чтобы считать надёжность."
                    >
                      {reliability.label}
                    </span>
                  ) : (
                    <span
                      className={
                        reliability.kind === 'none'
                          ? 'text-fg-tertiary'
                          : 'text-fg-primary'
                      }
                    >
                      {reliability.label}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-fg-secondary">
                  {r.promisesNoAnswer}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'forbidden_role') {
    return 'Нет доступа к план-факту по людям (нужна роль coo / admin / owner).';
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
