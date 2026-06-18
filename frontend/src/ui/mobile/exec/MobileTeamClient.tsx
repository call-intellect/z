"use client";

import useSWR from "swr";
import { AlertCircle, HeartHandshake, Users } from "lucide-react";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { fromOperationsOverviewApi } from "@/domain/operations-dashboard";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { ZoneTile } from "@/ui/mobile/shared/ZoneTile";
import { StatusDot } from "@/ui/mobile/shared/StatusDot";
import { DrillList } from "@/ui/mobile/shared/DrillList";
import {
  isTeamEmpty,
  moodGreenPercent,
  moodTone,
  teamHelpRows,
  teamSummaryStats,
} from "./team-rows";

export function MobileTeamClient() {
  const { currentOrgId } = useAuth();

  const swr = useSWR(
    currentOrgId ? ["operations-overview", currentOrgId] : null,
    async () => {
      const res = await operationsDashboardApi.getOverview();
      return fromOperationsOverviewApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const ops = swr.data ?? null;
  const loading = !!currentOrgId && swr.isLoading && !ops;
  const error = swr.error
    ? humanizeApiError(swr.error, "Не удалось загрузить команду")
    : null;

  const greenPct = moodGreenPercent(ops);
  const total = ops?.teamTemperature.totalCheckIns ?? 0;
  const tone = moodTone(ops?.teamTemperature.greenShare ?? 0, total);
  const help = teamHelpRows(ops);
  const stats = teamSummaryStats(ops);
  const empty = !loading && !error && isTeamEmpty(ops);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <Users size={20} className="text-accent" aria-hidden />
        Команда
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Настроение и кому помочь — за неделю.
      </p>

      {loading && <TeamSkeleton />}

      {!loading && error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && empty && (
        <div
          data-testid="team-empty"
          className="rounded-2xl border border-border-subtle bg-bg-card p-5 text-center"
        >
          <HeartHandshake
            size={24}
            className="mx-auto mb-2 text-accent"
            aria-hidden
          />
          <p className="text-base font-medium text-fg-primary">Пока тихо</p>
          <p className="mt-1 text-sm text-fg-secondary">
            Появятся чек-ины и встречи — здесь будет настроение команды и кому
            помочь.
          </p>
        </div>
      )}

      {!loading && !error && !empty && (
        <>
          {}
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-border-subtle bg-bg-card p-4">
            <div className="flex items-center gap-2">
              <StatusDot tone={tone} />
              <span className="text-sm font-medium text-fg-primary">
                Настроение команды
              </span>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold tabular-nums text-fg-primary">
                {greenPct === null ? "—" : `${greenPct}%`}
              </div>
              <div className="text-xs text-fg-tertiary">
                {greenPct === null ? "нет чек-инов" : "в добром настрое"}
              </div>
            </div>
          </div>

          {}
          {help.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg-secondary">
                <HeartHandshake size={15} className="text-accent" aria-hidden />
                Кому помочь
              </h2>
              <DrillList items={help} />
            </section>
          )}

          {}
          {stats.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {stats.map((s) => (
                <ZoneTile
                  key={s.key}
                  title={s.title}
                  value={s.value}
                  caption={s.caption}
                  tone={s.tone}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    </div>
  );
}
