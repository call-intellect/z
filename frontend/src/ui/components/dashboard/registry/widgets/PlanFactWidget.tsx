"use client";

import type { FC } from "react";
import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import {
  fromCheckinDisciplineApi,
  localDateString,
} from "@/domain/checkin-discipline";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  DonutCard,
  GlassCard,
  GRAD,
  StatCard,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { PeopleDrawer, PersonRow } from "../_kit";

const RHYTHM_DAYS: Record<Rhythm, number> = {
  today: 1,
  week: 7,
  month: 30,
};

function rangeFor(rhythm: Rhythm): { from: string; to: string; days: number } {
  const days = RHYTHM_DAYS[rhythm];
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: localDateString(from), to: localDateString(to), days };
}

export const PlanFactWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { from, to, days } = useMemo(() => rangeFor(rhythm), [rhythm]);

  const disciplineSwr = useSWR(
    currentOrgId ? ["planfact-discipline", currentOrgId, from, to] : null,
    async () =>
      operationsDashboardApi.getCheckinDiscipline(currentOrgId!, from, to),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const temperatureSwr = useSWR(
    currentOrgId ? ["planfact-temperature", currentOrgId, days] : null,
    async () => operationsDashboardApi.getTeamTemperature(days),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const missingSwr = useSWR(
    currentOrgId ? ["planfact-missing", currentOrgId] : null,
    async () => operationsDashboardApi.getMissingCheckIns(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const loading = disciplineSwr.isLoading || temperatureSwr.isLoading;

  if (loading) {
    return (
      <GlassCard>
        <CardTitle icon={<ClipboardCheck size={16} />} grad={GRAD.teal}>
          План и факт
        </CardTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </GlassCard>
    );
  }

  const discipline = disciplineSwr.data
    ? fromCheckinDisciplineApi(disciplineSwr.data)
    : null;
  const temperature = temperatureSwr.data ?? null;

  const totals = discipline?.totals ?? null;
  const morningExpected = totals?.morningExpected ?? 0;
  const morningCompleted = totals?.morningCompleted ?? 0;
  const eveningExpected = totals?.eveningExpected ?? 0;
  const eveningCompleted = totals?.eveningCompleted ?? 0;
  const totalEmployees = missingSwr.data?.totalEmployees ?? 0;

  const totalCheckIns = temperature?.totalCheckIns ?? 0;
  const hasData =
    morningExpected + eveningExpected > 0 || totalCheckIns > 0;

  if (!hasData) {
    return (
      <GlassCard>
        <CardTitle icon={<ClipboardCheck size={16} />} grad={GRAD.teal}>
          План и факт
        </CardTitle>
        <p
          className="mt-6 py-6 text-center text-sm"
          style={{ color: CHART.faint }}
        >
          Нет чек-инов за период — здесь появится, где реальность отстаёт от
          плана и почему.
        </p>
      </GlassCard>
    );
  }

  const totalGreen = Math.round((temperature?.greenShare ?? 0) * totalCheckIns);
  const totalYellow = Math.round(
    (temperature?.yellowShare ?? 0) * totalCheckIns,
  );
  const totalRed = Math.round((temperature?.redShare ?? 0) * totalCheckIns);

  const moodData = [
    { name: "В норме", value: totalGreen, c: CHART.mint },
    { name: "Устал", value: totalYellow, c: CHART.amber },
    { name: "Тяжело", value: totalRed, c: CHART.red },
  ];

  const byPerson = discipline?.byPerson ?? [];

  return (
    <GlassCard>
      <CardTitle icon={<ClipboardCheck size={16} />} grad={GRAD.teal}>
        План и факт
      </CardTitle>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--surface-inset)" }}
        >
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: CHART.dim }}
          >
            <ClipboardCheck size={16} /> Отчитались утром
          </div>
          <div className="mt-2 text-sm" style={{ color: CHART.text }}>
            сдали{" "}
            <span className="font-semibold tabular-nums">{morningCompleted}</span>{" "}
            / ожидалось{" "}
            <span className="font-semibold tabular-nums">{morningExpected}</span>{" "}
            / всего{" "}
            <span className="font-semibold tabular-nums">{totalEmployees}</span>{" "}
            сотрудников
          </div>
          {morningExpected < totalEmployees ? (
            <div className="mt-1 text-xs" style={{ color: CHART.faint }}>
              ожидался {morningExpected} из {totalEmployees}
            </div>
          ) : null}
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--surface-inset)" }}
        >
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: CHART.dim }}
          >
            <ClipboardCheck size={16} /> Подвели итог вечером
          </div>
          <div className="mt-2 text-sm" style={{ color: CHART.text }}>
            сдали{" "}
            <span className="font-semibold tabular-nums">{eveningCompleted}</span>{" "}
            / ожидалось{" "}
            <span className="font-semibold tabular-nums">{eveningExpected}</span>{" "}
            / всего{" "}
            <span className="font-semibold tabular-nums">{totalEmployees}</span>{" "}
            сотрудников
          </div>
          {eveningExpected < totalEmployees ? (
            <div className="mt-1 text-xs" style={{ color: CHART.faint }}>
              ожидался {eveningExpected} из {totalEmployees}
            </div>
          ) : null}
        </div>
        <StatCard
          icon={<ClipboardCheck size={18} />}
          grad={GRAD.violet}
          label="Всего чек-инов за период"
          value={String(totalCheckIns)}
          tone={CHART.violet}
        />
      </div>

      <div className="mt-4">
        <DonutCard
          title="Настроение команды"
          icon={<ClipboardCheck size={16} />}
          grad={GRAD.amber}
          data={moodData}
          centerValue={String(totalCheckIns)}
          centerLabel="чек-инов"
        />
      </div>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="mt-4 inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition hover:brightness-110"
        style={{
          background: "var(--surface-inset-strong)",
          color: CHART.text,
        }}
      >
        По людям
      </button>

      <PeopleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="По людям — кто отметился"
        subtitle="Клик по человеку — его чек-ины и пульс"
      >
        {byPerson.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Пока нет данных по людям.
          </p>
        ) : (
          byPerson.map((p) => (
            <PersonRow
              key={p.personId}
              href={`/persons/${p.personId}/pulse`}
              name={p.personName}
              sub={`утро ${p.morningCompleted}/${p.morningExpected} · вечер ${p.eveningCompleted}/${p.eveningExpected}`}
            />
          ))
        )}
      </PeopleDrawer>
    </GlassCard>
  );
};
