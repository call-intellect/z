"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock, Users, X } from "lucide-react";

import type { ReactNode } from "react";

import type { StuckIssueRowApi } from "@/api/execution-dashboard.api";
import { CHART, GRAD, glass } from "@/ui/components/dashboard/modern";
import { CardTitle } from "@/ui/components/dashboard/modern";
import { Chip } from "@/ui/components/dashboard/registry/_kit";

const VISIBLE_LIMIT = 5;

function InfoChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: "var(--chip-info-bg)", color: "var(--chip-info-fg)" }}
    >
      {children}
    </span>
  );
}

function staleChipTone(days: number): "risk" | "warn" | null {
  if (days >= 6) return "risk";
  if (days >= 3) return "warn";
  return null;
}

function staleChipLabel(days: number): string {
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "день" : "дн";
  return `просрочено ${days} ${word}`;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

type Aggregate = {
  key: string;
  name: string;
  count: number;
};

export function StaleTasksLinked({ items }: { items: StuckIssueRowApi[] }) {
  const [activeAssignee, setActiveAssignee] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const withOwner = useMemo(
    () => items.filter((i) => i.assigneeUserId !== null),
    [items],
  );
  const withoutOwner = useMemo(
    () => items.filter((i) => i.assigneeUserId === null),
    [items],
  );

  const aggregates = useMemo<Aggregate[]>(() => {
    const map = new Map<string, Aggregate>();
    for (const it of withOwner) {
      const key = it.assigneeUserId!;
      const name = it.assigneeName ?? "Без имени";
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { key, name, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [withOwner]);

  const maxCount = aggregates.length > 0 ? aggregates[0]!.count : 1;

  const filteredOwner = useMemo(() => {
    if (!activeAssignee) return withOwner;
    return withOwner.filter((i) => i.assigneeUserId === activeAssignee);
  }, [withOwner, activeAssignee]);

  const visibleOwner = showAll
    ? filteredOwner
    : filteredOwner.slice(0, VISIBLE_LIMIT);

  const activeName = activeAssignee
    ? (aggregates.find((a) => a.key === activeAssignee)?.name ?? null)
    : null;

  const toggleAssignee = (key: string) =>
    setActiveAssignee((cur) => (cur === key ? null : key));

  const isEmpty = items.length === 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
      <div style={glass()} className="p-6">
        <div className="flex items-center gap-3">
          <CardTitle icon={<Clock size={17} />} grad={GRAD.amber}>
            Зависшие и просроченные задачи
          </CardTitle>
          {activeName ? (
            <button
              type="button"
              onClick={() => setActiveAssignee(null)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5 text-xs font-semibold"
              style={{
                background: "var(--chip-info-bg)",
                color: "var(--chip-info-fg)",
              }}
            >
              Фильтр: {activeName}
              <span
                className="grid h-4 w-4 place-items-center rounded-full"
                style={{ background: "var(--surface-inset-strong)" }}
                aria-hidden
              >
                <X size={11} />
              </span>
            </button>
          ) : null}
        </div>

        {isEmpty ? (
          <p className="mt-4 text-sm" style={{ color: CHART.faint }}>
            Зависших и просроченных задач нет — всё в движении.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col">
              {visibleOwner.map((task) => (
                <Link
                  key={task.issueId}
                  href={`/issues/${task.issueId}`}
                  className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  {(() => {
                    const tone = staleChipTone(task.daysStuck);
                    return tone ? (
                      <Chip tone={tone}>{staleChipLabel(task.daysStuck)}</Chip>
                    ) : (
                      <InfoChip>{staleChipLabel(task.daysStuck)}</InfoChip>
                    );
                  })()}
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[13.5px] font-medium"
                      style={{ color: CHART.text }}
                    >
                      {task.title}
                    </span>
                    <span
                      className="mt-0.5 flex items-center gap-1.5 text-xs"
                      style={{ color: CHART.faint }}
                    >
                      <span
                        className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold"
                        style={{
                          background: "var(--surface-inset-strong)",
                          color: CHART.dim,
                        }}
                        aria-hidden
                      >
                        {initialOf(task.assigneeName ?? "?")}
                      </span>
                      {task.assigneeName}
                    </span>
                  </span>
                </Link>
              ))}
              {visibleOwner.length === 0 ? (
                <p className="px-2 py-3 text-sm" style={{ color: CHART.faint }}>
                  По этому фильтру задач нет.
                </p>
              ) : null}
            </div>

            {filteredOwner.length > VISIBLE_LIMIT ? (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl p-2.5 text-[12.5px] font-semibold transition-colors hover:bg-[var(--surface-hover)]"
                style={{
                  background: "var(--surface-inset)",
                  color: CHART.dim,
                }}
              >
                {showAll
                  ? "Свернуть список"
                  : `Показать все (${filteredOwner.length})`}
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={showAll ? "rotate-180 transition-transform" : "transition-transform"}
                />
              </button>
            ) : null}

            {withoutOwner.length > 0 ? (
              <div className="mt-5">
                <div
                  className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.06em]"
                  style={{ color: CHART.faint }}
                >
                  Без ответственного
                </div>
                <div className="flex flex-col">
                  {withoutOwner.map((task) => (
                    <Link
                      key={task.issueId}
                      href={`/issues/${task.issueId}`}
                      className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <InfoChip>без ответственного</InfoChip>
                      <span
                        className="block min-w-0 flex-1 truncate text-[13.5px] font-medium"
                        style={{ color: CHART.text }}
                      >
                        {task.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div style={glass()} className="p-6">
        <CardTitle icon={<Users size={17} />} grad={GRAD.pink}>
          Кто просрочил
        </CardTitle>
        {aggregates.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: CHART.faint }}>
            Никто не держит просроченных задач.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-1">
              {aggregates.map((agg) => {
                const active = agg.key === activeAssignee;
                return (
                  <button
                    key={agg.key}
                    type="button"
                    onClick={() => toggleAssignee(agg.key)}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                    style={
                      active
                        ? { background: "var(--chip-danger-bg)" }
                        : undefined
                    }
                  >
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold"
                      style={{
                        background: "var(--surface-inset-strong)",
                        color: CHART.text,
                      }}
                      aria-hidden
                    >
                      {initialOf(agg.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[13.5px] font-semibold"
                        style={{ color: CHART.text }}
                      >
                        {agg.name}
                      </span>
                      <span
                        className="mt-1.5 block h-1.5 overflow-hidden rounded-full"
                        style={{ background: "var(--surface-inset-strong)" }}
                        aria-hidden
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(8, (agg.count / maxCount) * 100)}%`,
                            background: GRAD.amber,
                          }}
                        />
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-[15px] font-bold tabular-nums"
                      style={{ color: CHART.red }}
                    >
                      {agg.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <p
              className="mt-3 text-[11.5px] leading-snug"
              style={{ color: CHART.faint }}
            >
              Клик по сотруднику фильтрует список слева. Видно, кто главный
              «узел».
            </p>
          </>
        )}
      </div>
    </div>
  );
}
