"use client";

import { useCallback, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { monthlyDigestApi } from "@/api/monthly-digest.api";
import { useAuth } from "@/contexts/auth-context";
import { useMonthCompanyDigest } from "@/hooks/useMonthCompany";
import { toast } from "@/ui/shadcn/toast";
import { Button } from "@/ui/shadcn/button";
import { CHART } from "@/ui/components/dashboard/modern";

import { MonthLetter } from "./MonthLetter";
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

  const {
    digest,
    isLoading: digestLoading,
    error: digestError,
    mutate: mutateDigest,
  } = useMonthCompanyDigest(currentOrgId);

  const regenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const period = digest?.periodYm ?? currentPeriodYm();
      await monthlyDigestApi.generate(period);
      await mutateDigest();
      toast.success("Отчёт пересобран");
    } catch {
      toast.error("Не удалось пересобрать отчёт");
    } finally {
      setRegenerating(false);
    }
  }, [regenerating, digest?.periodYm, mutateDigest]);

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
            Месячная сводка ещё не собрана
          </h2>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Кора сводит «Месяц компании» из недельных отчётов, целей и решений.
            Можно запустить сборку вручную.
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
  const coverTitle = verdict?.overall.title ?? "Месяц компании";
  const coverOneLiner =
    verdict?.overall.oneLiner ??
    "Месячная сводка готова — открой полный текст ниже.";
  const coverMeta = formatPeriodYm(digest.periodYm);

  return (
    <div className="mb-8 flex flex-col gap-4">
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
    </div>
  );
}
