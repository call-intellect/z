"use client";

import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, MessageCircle, Sparkles } from "lucide-react";

import { dashboardApi } from "@/api/dashboard.api";
import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { directorDashboardFromApi } from "@/domain/director-dashboard";
import { fromOperationsOverviewApi } from "@/domain/operations-dashboard";
import {
  fromCheckinDisciplineApi,
  localDateString,
  type CheckinDisciplineDomain,
} from "@/domain/checkin-discipline";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { EnableMorningRemindersButton } from "@/ui/pwa/EnableMorningRemindersButton";
import { ZoneTile } from "@/ui/mobile/shared/ZoneTile";
import { GlanceGauge } from "@/ui/mobile/shared/GlanceGauge";
import {
  isOverviewColdStart,
  overviewZonesFromDomain,
  requiresYouCount,
} from "./overview-zones";

export function MobileOverviewClient() {
  const { currentOrgId } = useAuth();

  const directorSwr = useSWR(
    currentOrgId ? ["mobile-overview-director", currentOrgId, "week"] : null,
    async () => {
      const res = await dashboardApi.getDirectorView(currentOrgId!, "week");
      return directorDashboardFromApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const operationsSwr = useSWR(
    currentOrgId ? ["operations-overview", currentOrgId] : null,
    async () => {
      const res = await operationsDashboardApi.getOverview();
      return fromOperationsOverviewApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const todayDate = localDateString();
  const checkinSwr = useSWR<CheckinDisciplineDomain | null>(
    currentOrgId
      ? ["mobile-checkin-discipline", currentOrgId, todayDate]
      : null,
    async () => {
      const res = await operationsDashboardApi.getCheckinDiscipline(
        currentOrgId!,
        todayDate,
        todayDate,
      );
      return fromCheckinDisciplineApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const director = directorSwr.data ?? null;
  const operations = operationsSwr.data ?? null;
  const checkin = checkinSwr.data ?? null;

  const loading = !!currentOrgId && directorSwr.isLoading && !director;
  const error = directorSwr.error
    ? humanizeApiError(directorSwr.error, "Не удалось загрузить обзор")
    : null;

  const requiresYou = requiresYouCount(director);
  const coldStart = isOverviewColdStart(director);
  const zones = overviewZonesFromDomain(director, operations);
  const valueStrip = director?.valueStrip ?? null;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5">
      <h1 className="mb-1 text-xl font-semibold text-fg-primary">Обзор</h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Главное за неделю — одним взглядом.
      </p>

      {loading && <OverviewSkeleton />}

      {!loading && error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && coldStart && (
        <div
          data-testid="overview-coldstart"
          className="mb-4 rounded-2xl border border-border-subtle bg-bg-card p-5 text-center"
        >
          <Sparkles
            size={24}
            className="mx-auto mb-2 text-accent"
            aria-hidden
          />
          <p className="text-base font-medium text-fg-primary">
            Граф ещё наполняется
          </p>
          <p className="mt-1 text-sm text-fg-secondary">
            Добавьте встречи и чаты — и Обзор оживёт.
          </p>
        </div>
      )}

      {!loading && !error && !coldStart && (
        <>
          {}
          {requiresYou > 0 && (
            <Link
              href="/me/notifications"
              className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-chip-warning-bg px-4 py-3 text-sm font-medium text-chip-warning-fg"
            >
              <span>Требует тебя</span>
              <span className="tabular-nums">{requiresYou}</span>
            </Link>
          )}

          {}
          <div className="grid grid-cols-2 gap-3">
            {zones.map((zone) =>
              zone.key === "goal" ? (
                <ZoneTile
                  key={zone.key}
                  title={zone.title}
                  tone={zone.tone}
                  href={zone.href}
                  caption={zone.caption}
                  value={<GlanceGauge percent={zone.gaugePercent ?? null} />}
                />
              ) : (
                <ZoneTile
                  key={zone.key}
                  title={zone.title}
                  value={zone.value}
                  caption={zone.caption}
                  tone={zone.tone}
                  href={zone.href}
                />
              ),
            )}
          </div>

          {}
          {valueStrip && (
            <div className="mt-4 rounded-2xl border border-border-subtle bg-bg-card p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Кора за неделю
              </div>
              <div className="grid grid-cols-3 gap-y-3 gap-x-2">
                <ValueStat n={valueStrip.meetingsProtocoled} label="встреч" />
                <ValueStat n={valueStrip.tasksExtracted} label="задач" />
                <ValueStat n={valueStrip.decisionsExtracted} label="решений" />
                <ValueStat
                  n={valueStrip.questionsAnsweredByMemory}
                  label="ответов"
                />
                <ValueStat n={valueStrip.commitmentsKept} label="обещаний" />
              </div>
            </div>
          )}

          {}
          <CheckinPill checkin={checkin} />
        </>
      )}

      {}
      <Link
        href="/chat"
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-fg active:opacity-90"
      >
        <MessageCircle size={18} aria-hidden />
        Спросить Кору
      </Link>

      {}
      <div className="mt-3">
        <EnableMorningRemindersButton />
      </div>
    </div>
  );
}

function ValueStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums text-fg-primary">
        {n}
      </span>
      <span className="text-xs text-fg-tertiary">{label}</span>
    </div>
  );
}

function CheckinPill({ checkin }: { checkin: CheckinDisciplineDomain | null }) {
  if (!checkin) return null;
  if (!checkin.enabled) {
    return (
      <div className="mt-3 rounded-2xl border border-border-subtle bg-bg-card p-3 text-xs text-fg-tertiary">
        Чек-ины выключены — нет данных о дисциплине.
      </div>
    );
  }
  const { morningMissed, eveningMissed } = checkin.totals;
  const allDone = morningMissed === 0 && eveningMissed === 0;
  return (
    <div
      className={
        allDone
          ? "mt-3 rounded-2xl bg-chip-success-bg px-4 py-3 text-sm font-medium text-chip-success-fg"
          : "mt-3 rounded-2xl bg-chip-warning-bg px-4 py-3 text-sm font-medium text-chip-warning-fg"
      }
    >
      {allDone ? (
        <span>Чек-ины сегодня: все сдали</span>
      ) : (
        <span>
          Чек-ины сегодня: не сдали утром {morningMissed} · вечером{" "}
          {eveningMissed}
        </span>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-20 w-full rounded-2xl" />
    </div>
  );
}
