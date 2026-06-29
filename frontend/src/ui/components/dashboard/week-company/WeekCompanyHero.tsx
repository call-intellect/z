"use client";

import { useCallback, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { dashboardApi } from "@/api/dashboard.api";
import { ideasApi } from "@/api/ideas.api";
import { insightsApi } from "@/api/insights.api";
import { weeklyDigestApi } from "@/api/weekly-digest.api";
import { useAuth } from "@/contexts/auth-context";
import {
  directorDashboardFromApi,
  type DirectorDashboardValueStripDomain,
} from "@/domain/director-dashboard";
import { useWeekCompanyDigest } from "@/hooks/useWeekCompany";
import { useSwrWithToast } from "@/hooks/useSwrWithToast";
import { toast } from "@/ui/shadcn/toast";
import { Button } from "@/ui/shadcn/button";
import { CHART } from "@/ui/components/dashboard/modern";
import { RisksIdeas } from "@/ui/components/dashboard/day-company/RisksIdeas";
import { PeriodValue } from "@/ui/components/dashboard/day-company/PeriodValue";

import { WeekGoalCompass } from "./WeekGoalCompass";
import { WeekLetter } from "./WeekLetter";
import { WeekVerdictCover } from "./WeekVerdictCover";

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  const y = monday.getFullYear();
  const m = `${monday.getMonth() + 1}`.padStart(2, "0");
  const d = `${monday.getDate()}`.padStart(2, "0");
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
        Собираем «Неделю компании»…
      </span>
    </div>
  );
}

export function WeekCompanyHero() {
  const { currentOrgId } = useAuth();
  const [regenerating, setRegenerating] = useState(false);

  const {
    digest,
    isLoading: digestLoading,
    error: digestError,
    mutate: mutateDigest,
  } = useWeekCompanyDigest(currentOrgId);

  const insightsSwr = useSwrWithToast(
    currentOrgId ? ["week-company.insights", currentOrgId] : null,
    async () => (await insightsApi.top(5)).items,
    { revalidateOnFocus: false, errorTitle: "Не удалось загрузить риски" },
  );

  const ideasSwr = useSwrWithToast(
    currentOrgId ? ["week-company.ideas", currentOrgId] : null,
    async () => (await ideasApi.top(currentOrgId!, 5)).items,
    { revalidateOnFocus: false, errorTitle: "Не удалось загрузить идеи" },
  );

  const directorSwr = useSwrWithToast<DirectorDashboardValueStripDomain>(
    currentOrgId ? ["week-company.director", currentOrgId, "week"] : null,
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
      const weekStart = digest?.weekStart ?? currentWeekStart();
      await weeklyDigestApi.generate(weekStart);
      await mutateDigest();
      toast.success("Отчёт пересобран");
    } catch {
      toast.error("Не удалось пересобрать отчёт");
    } finally {
      setRegenerating(false);
    }
  }, [regenerating, digest?.weekStart, mutateDigest]);

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
            «Неделя компании» сейчас недоступна
          </h2>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Не удалось загрузить недельную сводку. Попробуйте обновить страницу
            позже.
          </p>
        </div>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="mb-8">
        <div
          className="flex flex-col items-start gap-3 p-7"
          style={{
            background: "var(--glass-surface)",
            border: "1px solid var(--glass-border)",
            borderRadius: 24,
          }}
        >
          <h2 className="text-lg font-semibold" style={{ color: CHART.text }}>
            Недельная сводка ещё не собрана
          </h2>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Кора сводит «Неделю компании» из ежедневных отчётов, встреч и
            решений. Можно запустить сборку вручную.
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
  const coverTitle = verdict?.overall.title ?? "Неделя компании";
  const coverOneLiner =
    verdict?.overall.oneLiner ??
    "Недельная сводка готова — открой полный текст ниже.";
  const coverMeta = `Рабочая неделя ${digest.weekStart} – ${digest.weekEnd}`;

  return (
    <div className="mb-8 flex flex-col gap-4">
      <WeekVerdictCover
        emoji={verdict?.overall.emoji ?? null}
        title={coverTitle}
        oneLiner={coverOneLiner}
        meta={coverMeta}
        axes={verdict?.axes ?? null}
        dayTrend={digest.dayTrend}
        onRegenerate={regenerate}
        isRegenerating={regenerating}
      />

      <WeekLetter sections={digest.letter} fallbackProse={digest.bodyMarkdown} />

      {digest.goalAlignmentWeek ? (
        <WeekGoalCompass goal={digest.goalAlignmentWeek} />
      ) : null}

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
