"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Library } from "lucide-react";

import { regulationsApi } from "@/api/regulations.api";
import {
  mapRegulationSummary,
  type RegulationSummary,
} from "@/domain/regulation";
import {
  CardTitle as ModernCardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

type DigitizedCell = {
  key: keyof Pick<
    RegulationSummary,
    "regulations" | "processes" | "instructions" | "policies"
  >;
  labelForms: [one: string, few: string, many: string];
  value: number;
};

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return forms[1];
  return forms[2];
}

export function DigitizedSummaryWidget({ orgId }: { orgId: string | null }) {
  const summarySwr = useSWR<RegulationSummary | null>(
    orgId ? ["today-digitized-summary", orgId] : null,
    async () => {
      const res = await regulationsApi.getSummary();
      return mapRegulationSummary(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const summary = summarySwr.data ?? null;

  const cells = useMemo<DigitizedCell[]>(() => {
    if (!summary) return [];
    const base: DigitizedCell[] = [
      {
        key: "regulations",
        labelForms: ["регламент", "регламента", "регламентов"],
        value: summary.regulations,
      },
      {
        key: "processes",
        labelForms: ["процесс", "процесса", "процессов"],
        value: summary.processes,
      },
      {
        key: "instructions",
        labelForms: ["инструкция", "инструкции", "инструкций"],
        value: summary.instructions,
      },
    ];
    if (summary.policies > 0) {
      base.push({
        key: "policies",
        labelForms: ["политика", "политики", "политик"],
        value: summary.policies,
      });
    }
    return base;
  }, [summary]);

  const isEmpty = summary !== null && summary.total === 0;

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ModernCardTitle icon={<Library size={16} />} grad={GRAD.teal}>
          Оцифровано
        </ModernCardTitle>
        <Link
          href="/regulations"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
          style={{ color: CHART.cyan }}
        >
          Открыть
          <ArrowRight size={13} />
        </Link>
      </div>

      {summarySwr.isLoading || summary === null ? (
        <p className="text-sm" style={{ color: CHART.faint }}>
          Считаем оцифрованное…
        </p>
      ) : isEmpty ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm" style={{ color: CHART.dim }}>
            — Регламенты, процессы и инструкции появятся, когда Кора оцифрует
            знания со встреч и документов.
          </p>
          <Link
            href="/regulations"
            className="text-sm font-medium hover:underline"
            style={{ color: CHART.cyan }}
          >
            Открыть базу знаний →
          </Link>
        </div>
      ) : (
        <Link href="/regulations" className="block">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {cells.map((cell, i) => (
              <span
                key={cell.key}
                className="inline-flex items-baseline gap-1.5"
              >
                {i > 0 && (
                  <span
                    aria-hidden
                    className="mr-1"
                    style={{ color: CHART.faint }}
                  >
                    ·
                  </span>
                )}
                <span
                  className="text-[22px] font-semibold leading-none tabular-nums"
                  style={{ color: CHART.teal }}
                >
                  {cell.value}
                </span>
                <span className="text-sm" style={{ color: CHART.dim }}>
                  {plural(cell.value, cell.labelForms)}
                </span>
              </span>
            ))}
          </div>
          {summary.weekDelta > 0 && (
            <div className="mt-2 text-xs" style={{ color: CHART.mint }}>
              +{summary.weekDelta}{" "}
              {plural(summary.weekDelta, ["запись", "записи", "записей"])} за
              неделю
            </div>
          )}
        </Link>
      )}
    </GlassCard>
  );
}
