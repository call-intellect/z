'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import {
  fromDecisionThroughputApi,
  fromStalledDecisionsApi,
} from '@/domain/decision-throughput';
import { CardTitle, CHART, GlassCard, GRAD } from '@/ui/components/dashboard/modern';

/**
 * ТЗ coo-orphan-agents Ф3 — виджет «Доведение решений» на COO-доске
 * `/dashboard/operations`.
 *
 * Два независимых self-fetch SWR (`.catch`-safe — провал не валит доску):
 *   - `getDecisionThroughput()` — % решений, доведённых до результата за 90 дней;
 *   - `getStalledDecisions()` — решения без движения (stalled), список под баром.
 */

// Тон прогресс-бара → CSS-цвет нового языка.
const PROGRESS_COLOR: Record<'teal' | 'warn' | 'risk', string> = {
  teal: CHART.mint,
  warn: CHART.amber,
  risk: CHART.red,
};

export function DecisionThroughputWidget() {
  const throughputSwr = useSWR(
    ['operations-decision-throughput'],
    () => operationsDashboardApi.getDecisionThroughput().catch(() => null),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const stalledSwr = useSWR(
    ['operations-decisions-stalled'],
    () => operationsDashboardApi.getStalledDecisions().catch(() => null),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const tp = throughputSwr.data ? fromDecisionThroughputApi(throughputSwr.data) : null;
  const stalled = stalledSwr.data ? fromStalledDecisionsApi(stalledSwr.data) : null;

  return (
    <GlassCard>
      <CardTitle icon={<CheckCircle2 size={16} />} grad={GRAD.teal}>
        Доведение решений
      </CardTitle>
      <div className="mt-4">
        {throughputSwr.isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>Загрузка…</p>
        ) : !tp ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Данные появятся, когда наберётся история решений.
          </p>
        ) : tp.total === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Решений за период нет.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span
                className="text-3xl font-semibold tabular-nums"
                style={{ color: PROGRESS_COLOR[tp.progressTone] }}
              >
                {Math.round(tp.throughputPercent)}%
              </span>
              <span className="text-sm" style={{ color: CHART.dim }}>
                доведено · за 90 дней
              </span>
            </div>
            <p className="mt-1 text-xs" style={{ color: CHART.faint }}>
              {tp.doneWithOutcomes} из {tp.total} решений доведены до результата
            </p>
            <div
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--surface-inset-strong)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, tp.throughputPercent))}%`,
                  background: PROGRESS_COLOR[tp.progressTone],
                }}
                aria-hidden
              />
            </div>
          </>
        )}

        {/* Застрявшие решения — отдельный блок под прогрессом. */}
        {stalled && stalled.length > 0 ? (
          <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--surface-inset-strong)' }}>
            <p className="mb-2 text-xs font-medium" style={{ color: CHART.red }}>
              Застряло без движения: {stalled.length}
            </p>
            <ul className="space-y-1.5">
              {stalled.slice(0, 5).map((d) => (
                <li key={d.id} className="text-sm">
                  <Link
                    href={`/decisions/${encodeURIComponent(d.id)}`}
                    className="hover:underline"
                    style={{ color: CHART.text }}
                  >
                    <span className="line-clamp-1">{d.statement || 'Без формулировки'}</span>
                  </Link>
                  <span className="text-xs" style={{ color: CHART.faint }}>
                    {d.ageDays} дн. без движения
                  </span>
                </li>
              ))}
              {stalled.length > 5 ? (
                <li className="text-xs" style={{ color: CHART.faint }}>
                  …и ещё {stalled.length - 5}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}
