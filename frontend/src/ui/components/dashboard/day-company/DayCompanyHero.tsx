"use client";

import { useCallback, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { dashboardApi } from "@/api/dashboard.api";
import { ideasApi } from "@/api/ideas.api";
import { insightsApi } from "@/api/insights.api";
import { operationsDailyDigestApi } from "@/api/operations-daily-digest.api";
import { useAuth } from "@/contexts/auth-context";
import {
  directorDashboardFromApi,
  type DirectorDashboardValueStripDomain,
} from "@/domain/director-dashboard";
import {
  useDayAvailablePeriods,
  useDayCompanyDigest,
  useStaleTasksCrossProject,
} from "@/hooks/useDayCompany";
import { useSwrWithToast } from "@/hooks/useSwrWithToast";
import { comparePeriods, currentPeriod } from "@/domain/period";
import { toast } from "@/ui/shadcn/toast";
import { Button } from "@/ui/shadcn/button";
import { CHART } from "@/ui/components/dashboard/modern";
import { PeriodNavigator } from "@/ui/components/dashboard/shared/PeriodNavigator";

import { DayLetter } from "./DayLetter";
import { DayVerdictCover } from "./DayVerdictCover";
import { GoalCompassCard } from "./GoalCompassCard";
import { PeriodValue } from "./PeriodValue";
import { RisksIdeas } from "./RisksIdeas";
import { StaleTasksLinked } from "./StaleTasksLinked";

function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
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
        Собираем «День компании»…
      </span>
    </div>
  );
}

export function DayCompanyHero() {
  const { currentOrgId } = useAuth();
  const [regenerating, setRegenerating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { periods, latest } = useDayAvailablePeriods(currentOrgId);
  const effective = selected ?? latest;

  const {
    digest,
    isLoading: digestLoading,
    error: digestError,
    mutate: mutateDigest,
  } = useDayCompanyDigest(currentOrgId, effective);

  const { items: staleItems } = useStaleTasksCrossProject(currentOrgId);

  const insightsSwr = useSwrWithToast(
    currentOrgId ? ["day-company.insights", currentOrgId] : null,
    async () => (await insightsApi.top(5)).items,
    { revalidateOnFocus: false, errorTitle: "Не удалось загрузить риски" },
  );

  const ideasSwr = useSwrWithToast(
    currentOrgId ? ["day-company.ideas", currentOrgId] : null,
    async () => (await ideasApi.top(currentOrgId!, 5)).items,
    { revalidateOnFocus: false, errorTitle: "Не удалось загрузить идеи" },
  );

  const directorSwr = useSwrWithToast<DirectorDashboardValueStripDomain>(
    currentOrgId ? ["day-company.director", currentOrgId, "week"] : null,
    async () =>
      directorDashboardFromApi(
        await dashboardApi.getDirectorView(currentOrgId!, "week"),
      ).valueStrip,
    { revalidateOnFocus: false, errorTitle: "Не удалось загрузить пользу" },
  );

  const regenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const date = digest?.dateLocal ?? effective ?? localToday();
      await operationsDailyDigestApi.generate(date);
      await mutateDigest();
      toast.success("Отчёт пересобран");
    } catch {
      toast.error("Не удалось пересобрать отчёт");
    } finally {
      setRegenerating(false);
    }
  }, [regenerating, digest?.dateLocal, effective, mutateDigest]);

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
            «День компании» сейчас недоступен
          </h2>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Не удалось загрузить отчёт за вчера. Попробуйте обновить страницу
            позже.
          </p>
        </div>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="mb-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PeriodNavigator
            rhythm="day"
            value={effective ?? currentPeriod("day")}
            latest={latest ?? currentPeriod("day")}
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
        <div
          className="flex flex-col items-start gap-3 p-7"
          style={{
            background: "var(--glass-surface)",
            border: "1px solid var(--glass-border)",
            borderRadius: 24,
          }}
        >
          <h2 className="text-lg font-semibold" style={{ color: CHART.text }}>
            Отчёт за вчера ещё собирается
          </h2>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Кора собирает «День компании» из встреч, чатов и решений. Можно
            запустить сборку вручную.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={regenerating}
            className="gap-1.5"
          >
            <RotateCw
              size={14}
              aria-hidden
              className={regenerating ? "animate-spin" : undefined}
            />
            Пересобрать
          </Button>
        </div>
      </div>
    );
  }

  const verdict = digest.verdict;
  const coverTitle =
    verdict?.overall.title ?? digest.shortSummary ?? "День компании";
  const coverOneLiner =
    verdict?.overall.oneLiner ??
    digest.shortSummary ??
    "Отчёт за день готов — открой полный текст ниже.";
  const coverMeta = digest.shortSummary && verdict ? digest.shortSummary : null;

  return (
    <div className="mb-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodNavigator
          rhythm="day"
          value={effective ?? currentPeriod("day")}
          latest={latest ?? currentPeriod("day")}
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

      <DayVerdictCover
        emoji={verdict?.overall.emoji ?? null}
        title={coverTitle}
        oneLiner={coverOneLiner}
        meta={coverMeta}
        axes={verdict?.axes ?? null}
        onRegenerate={regenerate}
        isRegenerating={regenerating}
      />

      <DayLetter sections={digest.letter} fallbackProse={digest.bodyMarkdown} />

      {digest.goalAlignmentDay ? (
        <GoalCompassCard goal={digest.goalAlignmentDay} />
      ) : null}

      <StaleTasksLinked items={staleItems} />

      <RisksIdeas
        insights={insightsSwr.data ?? []}
        ideas={ideasSwr.data ?? []}
        risksSummary={digest.metrics.risksSummary ?? null}
        ideasSummary={digest.metrics.ideasSummary ?? null}
      />

      {directorSwr.data ? <PeriodValue data={directorSwr.data} /> : null}
    </div>
  );
}
