"use client";

import { CalendarCheck } from "lucide-react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  fromCheckinDisciplineApi,
  localDateString,
  type CheckinDisciplinePersonDomain,
} from "@/domain/checkin-discipline";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

export function CheckinDisciplineWidget({ weekStart }: { weekStart: string }) {
  const { currentOrgId } = useAuth();
  const to = localDateString();
  const swrKey = currentOrgId
    ? ["checkin-discipline", currentOrgId, weekStart, to]
    : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    () =>
      operationsDashboardApi
        .getCheckinDiscipline(currentOrgId!, weekStart, to)
        .then(fromCheckinDisciplineApi),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const friendlyError = (() => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === "forbidden") {
      return "Нет доступа к дисциплине чек-инов (нужна роль coo / admin / owner).";
    }
    return error instanceof Error
      ? error.message
      : "Не удалось загрузить дисциплину чек-инов.";
  })();

  return (
    <GlassCard>
      <CardTitle icon={<CalendarCheck size={16} />} grad={GRAD.teal}>
        Дисциплина чек-инов
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        Кто на этой неделе в ритме чек-инов, а кого стоит мягко вернуть. Это не
        оценка — подсказка, кому напомнить или чем помочь.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      ) : friendlyError ? (
        <p className="mt-4 text-sm" style={{ color: CHART.red }}>
          {friendlyError}
        </p>
      ) : !data ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          —
        </p>
      ) : !data.enabled ? (
        <div
          className="mt-4 rounded-2xl p-6 text-center"
          style={{ background: "var(--surface-inset)" }}
        >
          <p className="text-sm font-medium" style={{ color: CHART.dim }}>
            Чек-ины выключены
          </p>
          <p
            className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed"
            style={{ color: CHART.faint }}
          >
            Включите ежедневные чек-ины — и здесь появится дисциплина команды по
            утренним и вечерним ответам.
          </p>
        </div>
      ) : data.byPerson.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          За эту неделю ещё нет данных по чек-инам — они появятся по мере
          ответов команды.
        </p>
      ) : (
        <DisciplineTable rows={data.byPerson} />
      )}
    </GlassCard>
  );
}

function DisciplineTable({ rows }: { rows: CheckinDisciplinePersonDomain[] }) {
  const sorted = [...rows].sort((a, b) => missedCount(b) - missedCount(a));
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr
            className="border-b border-border-subtle text-left text-xs"
            style={{ color: CHART.faint }}
          >
            <th className="py-2 pr-3 font-medium">Сотрудник</th>
            <th className="py-2 pr-3 text-right font-medium">Утро</th>
            <th className="py-2 pr-3 text-right font-medium">Вечер</th>
            <th className="py-2 text-right font-medium">Ритм</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.personId} className="border-b border-border-subtle/50">
              <td
                className="py-2 pr-3 font-medium"
                style={{ color: CHART.text }}
              >
                {r.personName}
              </td>
              <td className="py-2 pr-3 text-right">
                <SlotCell
                  completed={r.morningCompleted}
                  expected={r.morningExpected}
                />
              </td>
              <td className="py-2 pr-3 text-right">
                <SlotCell
                  completed={r.eveningCompleted}
                  expected={r.eveningExpected}
                />
              </td>
              <td className="py-2 text-right">
                <RhythmChip row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlotCell({
  completed,
  expected,
}: {
  completed: number;
  expected: number;
}) {
  if (expected === 0) {
    return (
      <span className="text-xs" style={{ color: CHART.faint }}>
        —
      </span>
    );
  }
  const missed = expected - completed;
  return (
    <span className="tabular-nums text-xs" style={{ color: CHART.dim }}>
      {completed} из {expected}
      {missed > 0 ? (
        <span className="ml-1" style={{ color: CHART.amber }}>
          (−{missed})
        </span>
      ) : null}
    </span>
  );
}

function RhythmChip({ row }: { row: CheckinDisciplinePersonDomain }) {
  const expected = row.morningExpected + row.eveningExpected;
  const missed = missedCount(row);
  if (expected === 0) {
    return (
      <span className="text-xs" style={{ color: CHART.faint }}>
        —
      </span>
    );
  }
  if (missed === 0) {
    return (
      <span className="rounded-full bg-chip-success-bg px-2 py-0.5 text-[11px] font-medium text-chip-success-fg">
        в ритме
      </span>
    );
  }
  const heavy = missed > expected / 2;
  return heavy ? (
    <span className="rounded-full bg-chip-info-bg px-2 py-0.5 text-[11px] font-medium text-chip-info-fg">
      чем помочь
    </span>
  ) : (
    <span className="rounded-full bg-chip-warning-bg px-2 py-0.5 text-[11px] font-medium text-chip-warning-fg">
      напомнить
    </span>
  );
}

function missedCount(r: CheckinDisciplinePersonDomain): number {
  return r.morningMissed + r.eveningMissed;
}
