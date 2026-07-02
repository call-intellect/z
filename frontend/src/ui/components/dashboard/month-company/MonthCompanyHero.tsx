"use client";

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

import { monthlyDigestApi } from "@/api/monthly-digest.api";
import { useAuth } from "@/contexts/auth-context";
import {
  useMonthAvailablePeriods,
  useMonthCompanyDigest,
} from "@/hooks/useMonthCompany";
import { useStaleTasksCrossProject } from "@/hooks/useDayCompany";
import {
  comparePeriods,
  currentPeriod,
  formatPeriodLabel,
  nearestAvailablePeriod,
} from "@/domain/period";
import { toast } from "@/ui/shadcn/toast";
import { CHART } from "@/ui/components/dashboard/modern";
import { PeriodNavigator } from "@/ui/components/dashboard/shared/PeriodNavigator";
import { PeriodEmptyState } from "@/ui/components/dashboard/shared/PeriodEmptyState";
import { StaleTasksLinked } from "@/ui/components/dashboard/day-company/StaleTasksLinked";
import { MonthRecapWidget } from "@/ui/components/dashboard/registry/widgets/MonthRecapWidget";
import { AchievementsWidget } from "@/ui/components/dashboard/registry/widgets/AchievementsWidget";
import { WeeklyDynamicsWidget } from "@/ui/components/dashboard/registry/widgets/WeeklyDynamicsWidget";
import { MaturityCardWidget } from "@/ui/components/dashboard/registry/widgets/MaturityCardWidget";
import { BusFactorCardWidget } from "@/ui/components/dashboard/registry/widgets/BusFactorCardWidget";
import { WeeklyPerPersonWidget } from "@app/(authenticated)/dashboard/operations/weekly/WeeklyPerPersonWidget";

import { MonthBlockers } from "./MonthBlockers";
import { MonthForks } from "./MonthForks";
import { MonthGoalCompass } from "./MonthGoalCompass";
import { MonthLetter } from "./MonthLetter";
import { MonthNextFocus } from "./MonthNextFocus";
import { MonthSignalsGrid } from "./MonthSignalsGrid";
import { MonthVerdictCover } from "./MonthVerdictCover";

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

function currentPeriodYm(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${y}-${m}`;
}

function formatPeriodYm(periodYm: string): string {
  const [yearRaw, monthRaw] = periodYm.split("-");
  const monthIndex = Number(monthRaw) - 1;
  const name = MONTH_NAMES[monthIndex];
  if (!name || !yearRaw) return periodYm;
  return `${name} ${yearRaw}`;
}

function monthBoundsYmd(periodYm: string): { from: string; to: string } {
  const [yearRaw, monthRaw] = periodYm.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dd = `${lastDay}`.padStart(2, "0");
  const mm = `${month}`.padStart(2, "0");
  return { from: `${yearRaw}-${mm}-01`, to: `${yearRaw}-${mm}-${dd}` };
}

function HeroSkeleton() {
  return (
    <div
      className="flex items-center justify-center gap-3 p-12"
      style={{
        background: "var(--glass-surface)",
        border: "1px solid var(--glass-border)",
        borderRadius: 24,
      }}
      role="status"
    >
      <Loader2 size={18} className="animate-spin" style={{ color: CHART.dim }} />
      <span className="text-sm" style={{ color: CHART.dim }}>
        Собираем «Месяц компании»…
      </span>
    </div>
  );
}

export function MonthCompanyHero() {
  const { currentOrgId } = useAuth();
  const [regenerating, setRegenerating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { periods, latest } = useMonthAvailablePeriods(currentOrgId);
  const effective = selected ?? latest;

  const {
    digest,
    isLoading: digestLoading,
    error: digestError,
    mutate: mutateDigest,
  } = useMonthCompanyDigest(currentOrgId, effective);

  const { items: staleItems } = useStaleTasksCrossProject(currentOrgId);

  const regenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const period = digest?.periodYm ?? effective ?? currentPeriodYm();
      await monthlyDigestApi.generate(period);
      await mutateDigest();
      toast.success("Отчёт пересобран");
    } catch {
      toast.error("Не удалось пересобрать отчёт");
    } finally {
      setRegenerating(false);
    }
  }, [regenerating, digest?.periodYm, effective, mutateDigest]);

  if (!currentOrgId) return null;

  if (digestLoading) {
    return (
      <div className="mb-8">
        <HeroSkeleton />
      </div>
    );
  }

  if (digestError) {
    return (
      <div className="mb-8">
        <div
          className="flex flex-col gap-3 p-7"
          style={{
            background: "var(--glass-surface)",
            border: "1px solid var(--glass-border)",
            borderRadius: 24,
          }}
        >
          <h2 className="text-lg font-semibold" style={{ color: CHART.text }}>
            «Месяц компании» сейчас недоступен
          </h2>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Не удалось загрузить месячную сводку. Попробуйте обновить страницу
            позже.
          </p>
        </div>
      </div>
    );
  }

  if (!digest) {
    const hasOtherPeriods = periods.length > 0;
    const nearest = nearestAvailablePeriod(
      effective ?? currentPeriod("month"),
      periods.map((p) => p.period),
    );
    return (
      <div className="mb-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PeriodNavigator
            rhythm="month"
            value={effective ?? currentPeriod("month")}
            latest={latest ?? currentPeriod("month")}
            available={periods}
            onChange={(p) => setSelected(p)}
          />
          {selected && latest && comparePeriods(selected, latest) !== 0 ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--surface-inset)", color: CHART.dim }}
            >
              К последнему
            </button>
          ) : null}
        </div>
        <PeriodEmptyState
          surface="month"
          hasOtherPeriods={hasOtherPeriods}
          periodLabel={formatPeriodLabel(
            "month",
            effective ?? currentPeriod("month"),
          )}
          onJumpNearest={() => {
            if (nearest) setSelected(nearest);
          }}
          onToLatest={() => setSelected(null)}
          onRegenerate={regenerate}
          isRegenerating={regenerating}
        />
      </div>
    );
  }

  const verdict = digest.verdict;
  const coverTitle = verdict?.overall.title ?? "Месяц компании";
  const coverOneLiner =
    verdict?.overall.oneLiner ??
    "Месячная сводка готова — открой полный текст ниже.";
  const coverMeta = formatPeriodYm(digest.periodYm);
  const monthWindow = monthBoundsYmd(digest.periodYm);

  return (
    <div className="mb-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodNavigator
          rhythm="month"
          value={effective ?? currentPeriod("month")}
          latest={latest ?? currentPeriod("month")}
          available={periods}
          onChange={(p) => setSelected(p)}
        />
        {selected && latest && comparePeriods(selected, latest) !== 0 ? (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: "var(--surface-inset)", color: CHART.dim }}
          >
            К последнему
          </button>
        ) : null}
      </div>

      <MonthVerdictCover
        emoji={verdict?.overall.emoji ?? null}
        title={coverTitle}
        oneLiner={coverOneLiner}
        meta={coverMeta}
        axes={verdict?.axes ?? null}
        weekTrend={digest.weekTrend}
        onRegenerate={regenerate}
        isRegenerating={regenerating}
      />

      <MonthLetter
        sections={digest.letter}
        fallbackProse={digest.bodyMarkdown}
      />

      {digest.goalAlignmentMonth ? (
        <MonthGoalCompass goal={digest.goalAlignmentMonth} />
      ) : null}

      <WeeklyPerPersonWidget
        weekStart={monthWindow.from}
        weekEnd={monthWindow.to}
        title="План-факт за месяц по людям"
        subtitle="План-факт по людям: задачи и чек-ины за месяц."
        emptyHint="За этот месяц ещё нет данных по людям — появятся по мере работы команды."
      />

      <StaleTasksLinked items={staleItems} />

      <MonthForks ownerForks={digest.metrics.ownerForks} />

      <MonthNextFocus items={digest.metrics.nextFocus} />

      <MonthBlockers items={digest.metrics.blockers ?? []} />

      <MonthSignalsGrid
        insights={digest.metrics.risksByCause ?? []}
        frictions={digest.metrics.teamFrictions ?? []}
        clusters={digest.metrics.ideaClusters ?? []}
        risksSummary={digest.metrics.risksSummary ?? null}
        ideasSummary={digest.metrics.ideasSummary ?? null}
      />

      <div className="mt-2 flex flex-col gap-4">
        <h2 className="text-lg font-semibold" style={{ color: CHART.text }}>
          Итоги месяца
        </h2>
        <MonthRecapWidget rhythm="month" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AchievementsWidget rhythm="month" />
          <WeeklyDynamicsWidget rhythm="month" />
          <MaturityCardWidget rhythm="month" />
          <BusFactorCardWidget rhythm="month" />
        </div>
      </div>
    </div>
  );
}
