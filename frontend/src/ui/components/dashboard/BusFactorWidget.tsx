'use client';

import { AlertTriangle, ShieldCheck } from 'lucide-react';

import type { PulsePatternBusFactorApi } from '@/domain/pulse-patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * BusFactorWidget (Pulse Wave 6 §6.1) — «Угрозы непрерывности».
 *
 * Показывает топ-N категорий знаний с `riskLevel='critical'` (≤1 эксперта).
 * Источник: `KnowledgeRiskSnapshot` через `PulsePatternsService`.
 */

type Props = {
  data: PulsePatternBusFactorApi | null;
  loading: boolean;
  error: string | null;
};

export function BusFactorWidget({ data, loading, error }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle size={16} className="text-chip-danger-fg" />
          Угрозы непрерывности
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}
        {!loading && !error && data && data.critical.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-bg-overlay/40 p-6 text-center">
            <ShieldCheck size={28} className="text-chip-success-fg" />
            <p className="text-sm text-fg-secondary">
              Нет критических knowledge-зон — знания распределены равномерно.
            </p>
          </div>
        )}
        {!loading && !error && data && data.critical.length > 0 && (
          <ul className="space-y-2">
            {data.critical.map((item) => (
              <li
                key={item.categoryName}
                className="flex items-start justify-between gap-3 rounded-md p-2 hover:bg-bg-overlay/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg-primary">
                    {item.categoryName}
                  </p>
                  {item.topExperts.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-fg-tertiary">
                      Эксперт: {item.topExperts.join(', ')}
                    </p>
                  )}
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full bg-chip-danger-bg px-2.5 py-1 text-xs font-medium text-chip-danger-fg">
                  {item.expertsCount === 0
                    ? 'Нет экспертов'
                    : `${item.expertsCount} эксперт`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && data && data.warningCount > 0 && (
          <p className="mt-3 text-[11px] text-fg-tertiary">
            Ещё {data.warningCount} категорий в зоне предупреждения · всего
            отслеживается {data.totalCategories}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
