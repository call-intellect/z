"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Users } from "lucide-react";

import { ApiError } from "@/api/api-error";
import { weeklyPerPersonApi } from "@/api/weekly-per-person.api";
import {
  goalContributionDisplay,
  pluralRu,
  reliabilityDisplay,
  weeklyPerPersonFromApi,
  weeklyPersonItemFromApi,
  type WeeklyPerPersonUi,
  type WeeklyPersonItemTone,
  type WeeklyPersonItemUi,
  type WeeklyPersonRowUi,
} from "@/domain/weekly-per-person";
import { buildPlanerkaCsv, type PlanerkaPerson } from "@/domain/planerka-csv";
import { CardTitle, GlassCard, GRAD } from "@/ui/components/dashboard/modern";
import { toast } from "@/ui/shadcn/toast";

export function WeeklyPerPersonWidget({
  weekStart,
  weekEnd,
  title,
  subtitle,
  emptyHint,
}: {
  weekStart: string;
  weekEnd?: string;
  title?: string;
  subtitle?: string;
  emptyHint?: string;
}) {
  const [data, setData] = useState<WeeklyPerPersonUi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [allRows, setAllRows] = useState<WeeklyPersonRowUi[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(false);
    setAllRows(null);
    setAllError(null);
    weeklyPerPersonApi
      .get(weekStart, { sort: "reliability", weekEnd })
      .then((res) => {
        if (cancelled) return;
        setData(weeklyPerPersonFromApi(res));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(toMessage(err, "Не удалось загрузить план-факт по людям"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  const loadAll = () => {
    setAllLoading(true);
    setAllError(null);
    weeklyPerPersonApi
      .get(weekStart, { limit: 100, offset: 0, sort: "reliability", weekEnd })
      .then((res) => {
        setAllRows(weeklyPerPersonFromApi(res).rows);
        setExpanded(true);
      })
      .catch((err: unknown) => {
        setAllError(toMessage(err, "Не удалось загрузить полный список"));
      })
      .finally(() => {
        setAllLoading(false);
      });
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const full = weeklyPerPersonFromApi(
        await weeklyPerPersonApi.get(weekStart, {
          limit: 100,
          offset: 0,
          sort: "reliability",
          weekEnd,
        }),
      );
      const rows = full.rows;
      if (rows.length === 0) {
        toast.error("За эту неделю нет данных для выгрузки");
        return;
      }

      const BATCH = 6;
      const people: PlanerkaPerson[] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const loaded = await Promise.all(
          slice.map(async (row) => {
            const res = await weeklyPerPersonApi.items(weekStart, row.personId);
            return {
              personName: row.personName,
              items: res.items.map(weeklyPersonItemFromApi),
            } satisfies PlanerkaPerson;
          }),
        );
        people.push(...loaded);
      }

      const csv = buildPlanerkaCsv(people);
      const blob = new Blob(["﻿", csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `planerka-${weekStart}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Таблица для планёрки скачана");
    } catch (err: unknown) {
      toast.error(toMessage(err, "Не удалось собрать таблицу для планёрки"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <GlassCard>
      <CardTitle icon={<Users size={16} />} grad={GRAD.blue}>
        {title ?? "Кто держит слово — за неделю"}
      </CardTitle>
      <p className="mt-1 text-sm text-fg-secondary">
        {subtitle ??
          "План-факт по людям: обещания, задачи и чек-ины за неделю."}
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
          {emptyHint ??
            "За эту неделю ещё нет данных по людям — обещания, задачи и чек-ины появятся по мере работы команды."}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ReliableColumn rows={data.topReliable} weekStart={weekStart} />
            <RiskColumn rows={data.topRisk} weekStart={weekStart} />
          </div>

          <div className="mt-4 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {!expanded ? (
                <button
                  type="button"
                  onClick={loadAll}
                  disabled={allLoading}
                  className="rounded border px-3 py-1 text-sm text-fg-primary hover:bg-bg-subtle disabled:opacity-50"
                >
                  {allLoading ? "Загрузка…" : "Показать всех"}
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
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                title="Скачать построчную таблицу план-факт по всем людям в CSV"
                className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-sm text-accent-fg hover:bg-accent-hover disabled:opacity-50"
              >
                {exporting ? (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-fg/40 border-t-accent-fg"
                  />
                ) : (
                  <Download size={14} aria-hidden />
                )}
                {exporting ? "Готовим…" : "Скачать для планёрки"}
              </button>
            </div>
            {allError ? (
              <p className="mt-3 rounded border border-chip-warning-bg bg-chip-warning-bg p-3 text-sm text-chip-warning-fg">
                {allError}
              </p>
            ) : null}
            {expanded && !allError ? (
              <AllRowsTable rows={allRows ?? []} weekStart={weekStart} />
            ) : null}
          </div>
        </>
      )}
    </GlassCard>
  );
}

function ReliableColumn({
  rows,
  weekStart,
}: {
  rows: WeeklyPersonRowUi[];
  weekStart: string;
}) {
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
            <PersonRow
              key={r.personId}
              row={r}
              tone="success"
              weekStart={weekStart}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RiskColumn({
  rows,
  weekStart,
}: {
  rows: WeeklyPersonRowUi[];
  weekStart: string;
}) {
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
            <PersonRow
              key={r.personId}
              row={r}
              tone="danger"
              weekStart={weekStart}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonRow({
  row,
  tone,
  weekStart,
}: {
  row: WeeklyPersonRowUi;
  tone: "success" | "danger";
  weekStart: string;
}) {
  const drill = usePersonItems(weekStart, row.personId);
  const toneChip =
    tone === "success"
      ? "bg-chip-success-bg text-chip-success-fg"
      : "bg-chip-danger-bg text-chip-danger-fg";
  const broken = row.promisesBroken + row.promisesOverdue;
  const reliability = reliabilityDisplay(row);
  const reliabilityChip =
    reliability.kind === "low_data"
      ? "bg-chip-warning-bg text-chip-warning-fg"
      : reliability.kind === "none"
        ? "bg-bg-subtle text-fg-tertiary"
        : toneChip;
  const reliabilityTitle =
    reliability.kind === "low_data"
      ? "Слишком мало обещаний за неделю, чтобы считать надёжность."
      : "Надёжность: доля сдержанных обещаний за неделю";
  return (
    <li className="rounded-md bg-bg-card">
      <button
        type="button"
        onClick={drill.toggle}
        aria-expanded={drill.open}
        className="flex w-full items-start gap-1.5 rounded-md p-2 text-left hover:bg-bg-subtle"
      >
        <span aria-hidden className="mt-0.5 shrink-0 text-fg-tertiary">
          {drill.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg-primary">
              {row.personName}
            </span>
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
          </span>
          <span className="mt-1 block text-xs text-fg-secondary">
            {tone === "success" ? (
              <>
                Сдержал {row.promisesKept} из {row.promisesGiven}{" "}
                {pluralRu(row.promisesGiven, [
                  "обещания",
                  "обещаний",
                  "обещаний",
                ])}
                .
              </>
            ) : broken > 0 ? (
              <>
                {row.promisesOverdue > 0
                  ? `Просрочил ${row.promisesOverdue}`
                  : `Сорвал ${row.promisesBroken}`}{" "}
                из {row.promisesGiven}{" "}
                {pluralRu(row.promisesGiven, [
                  "обещания",
                  "обещаний",
                  "обещаний",
                ])}
                .
              </>
            ) : (
              <>Дал {row.promisesGiven}, но ещё не закрыл.</>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-tertiary">
            <span>
              Задачи: {row.tasksDone}
              {row.tasksPlanned > 0 ? `/${row.tasksPlanned}` : ""}
            </span>
            {row.tasksNotDone > 0 ? (
              <span className="rounded bg-chip-warning-bg px-1.5 py-0.5 text-chip-warning-fg">
                {row.tasksNotDone} не сделано
              </span>
            ) : null}
            <span>· Чек-ины: {row.checkInsCompleted}</span>
            <GoalContributionChip net={row.goalContributionNet} />
          </span>
        </span>
      </button>
      {drill.open ? <PersonItemsDrill drill={drill} /> : null}
    </li>
  );
}

function GoalContributionChip({ net }: { net: number | null }) {
  const goal = goalContributionDisplay(net);
  const chip =
    goal.tone === "pos"
      ? "bg-chip-success-bg text-chip-success-fg"
      : goal.tone === "neg"
        ? "bg-chip-danger-bg text-chip-danger-fg"
        : "bg-bg-subtle text-fg-tertiary";
  return (
    <span
      className={`rounded px-1.5 py-0.5 tabular-nums ${chip}`}
      title="Вклад в главную цель за неделю: pro−contra"
    >
      Вклад в цель: {goal.label}
    </span>
  );
}

interface PersonItemsState {
  open: boolean;
  loading: boolean;
  error: string | null;
  items: WeeklyPersonItemUi[] | null;
  toggle: () => void;
}

function usePersonItems(weekStart: string, personId: string): PersonItemsState {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WeeklyPersonItemUi[] | null>(null);

  useEffect(() => {
    setOpen(false);
    setItems(null);
    setError(null);
    setLoading(false);
  }, [weekStart, personId]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (items !== null || loading) return;
    setLoading(true);
    setError(null);
    weeklyPerPersonApi
      .items(weekStart, personId)
      .then((res) => {
        setItems(res.items.map(weeklyPersonItemFromApi));
      })
      .catch((err: unknown) => {
        setError(toMessage(err, "Не удалось загрузить план-факт человека"));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return { open, loading, error, items, toggle };
}

const TONE_CHIP: Record<WeeklyPersonItemTone, string> = {
  ok: "bg-chip-success-bg text-chip-success-fg",
  risk: "bg-chip-danger-bg text-chip-danger-fg",
  warn: "bg-chip-warning-bg text-chip-warning-fg",
  neutral: "bg-chip-info-bg text-chip-info-fg",
};

function PersonItemsDrill({ drill }: { drill: PersonItemsState }) {
  return (
    <div className="border-t border-border-subtle px-2 pb-2 pt-2">
      {drill.loading ? (
        <p className="rounded bg-bg-subtle p-2 text-xs text-fg-secondary">
          Загрузка…
        </p>
      ) : drill.error ? (
        <p className="rounded border border-chip-warning-bg bg-chip-warning-bg p-2 text-xs text-chip-warning-fg">
          {drill.error}
        </p>
      ) : !drill.items || drill.items.length === 0 ? (
        <p className="rounded bg-bg-subtle p-2 text-xs text-fg-tertiary">
          За неделю пунктов нет.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-border-subtle text-left text-fg-tertiary">
                <th className="py-1.5 pr-3 font-medium">Что</th>
                <th className="py-1.5 pr-3 font-medium">Тип</th>
                <th className="py-1.5 pr-3 font-medium">План (срок)</th>
                <th className="py-1.5 pr-3 font-medium">Факт</th>
                <th className="py-1.5 font-medium">Что мешало</th>
              </tr>
            </thead>
            <tbody>
              {drill.items.map((it, i) => (
                <tr
                  key={`${it.kind}-${i}`}
                  className="border-b border-border-subtle/50 last:border-0"
                >
                  <td className="py-1.5 pr-3 text-fg-primary">{it.title}</td>
                  <td className="py-1.5 pr-3 text-fg-secondary">
                    {it.kindLabel}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-fg-secondary">
                    {it.plannedDueLabel}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] ${TONE_CHIP[it.tone]}`}
                    >
                      {it.factLabel}
                    </span>
                  </td>
                  <td className="py-1.5 text-fg-secondary">
                    {it.blockedBy ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AllRowsTable({
  rows,
  weekStart,
}: {
  rows: WeeklyPersonRowUi[];
  weekStart: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 rounded border bg-bg-subtle p-4 text-sm text-fg-secondary">
        За эту неделю ещё нет данных по людям.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((r) => (
        <AllRowItem key={r.personId} row={r} weekStart={weekStart} />
      ))}
    </ul>
  );
}

function AllRowItem({
  row,
  weekStart,
}: {
  row: WeeklyPersonRowUi;
  weekStart: string;
}) {
  const drill = usePersonItems(weekStart, row.personId);
  const reliability = reliabilityDisplay(row);
  return (
    <li className="rounded-md border border-border-subtle bg-bg-card">
      <button
        type="button"
        onClick={drill.toggle}
        aria-expanded={drill.open}
        className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-bg-subtle"
      >
        <span aria-hidden className="shrink-0 text-fg-tertiary">
          {drill.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg-primary">
          {row.personName}
        </span>
        <span className="shrink-0 text-xs text-fg-tertiary">
          {row.departmentName ?? "—"}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
          Сдержал {row.promisesKept}/{row.promisesGiven}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
          Задачи {row.tasksDone}
          {row.tasksPlanned > 0 ? `/${row.tasksPlanned}` : ""}
        </span>
        {row.tasksNotDone > 0 ? (
          <span className="shrink-0 rounded bg-chip-warning-bg px-1.5 py-0.5 text-[11px] text-chip-warning-fg">
            {row.tasksNotDone} не сделано
          </span>
        ) : null}
        <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
          Чек-ины {row.checkInsCompleted}
        </span>
        <span className="shrink-0 text-[11px]">
          <GoalContributionChip net={row.goalContributionNet} />
        </span>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[11px] tabular-nums ${
            reliability.kind === "low_data"
              ? "bg-chip-warning-bg text-chip-warning-fg"
              : reliability.kind === "none"
                ? "bg-bg-subtle text-fg-tertiary"
                : "bg-chip-info-bg text-chip-info-fg"
          }`}
          title={
            reliability.kind === "low_data"
              ? "Слишком мало обещаний за неделю, чтобы считать надёжность."
              : "Надёжность: доля сдержанных обещаний за неделю"
          }
        >
          {reliability.label}
        </span>
      </button>
      {drill.open ? <PersonItemsDrill drill={drill} /> : null}
    </li>
  );
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === "forbidden_role") {
    return "Нет доступа к план-факту по людям (нужна роль coo / admin / owner).";
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
