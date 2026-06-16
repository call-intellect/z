'use client';

import { Network } from 'lucide-react';
import useSWR from 'swr';

import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import { fromPromiseNetworkApi } from '@/domain/promise-network';
import { CardTitle, CHART, GlassCard, GRAD } from '@/ui/components/dashboard/modern';

/**
 * ТЗ coo-orphan-agents Ф7 — виджет «Перегруз ответственностью» на COO-доске.
 *
 * Self-fetch через SWR на `operationsDashboardApi.getPromiseNetwork()`. Снапшот
 * `PromiseNetworkSnapshot` пишется cron'ом еженедельно (по понедельникам), поэтому
 * «нет данных» — ожидаемое состояние в первую неделю. Показываем accumulators
 * (топ-5): на ком висит много обещаний (входящих) при малой отдаче (исходящих).
 */
export function PromiseOverloadWidget() {
  const swr = useSWR(
    ['operations-promise-network'],
    () => operationsDashboardApi.getPromiseNetwork().catch(() => null),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const data = swr.data ? fromPromiseNetworkApi(swr.data) : null;
  const accumulators = data?.accumulators ?? [];

  return (
    <GlassCard>
      <CardTitle icon={<Network size={16} />} grad={GRAD.violet}>
        Перегруз ответственностью
      </CardTitle>
      <div className="mt-4">
        {swr.isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>Загрузка…</p>
        ) : !data || !data.hasData || accumulators.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Накопится за неделю — карта обещаний считается по понедельникам.
          </p>
        ) : (
          <ul className="space-y-2">
            {accumulators.slice(0, 5).map((n) => (
              <li
                key={n.personId}
                className="flex items-center justify-between gap-3 rounded-xl p-3"
                style={{ background: 'var(--surface-inset)' }}
              >
                <span className="text-sm font-medium" style={{ color: CHART.text }}>
                  {n.name}
                </span>
                <span className="text-xs tabular-nums" style={{ color: CHART.faint }}>
                  на нём {n.inDegree} · раздаёт {n.outDegree}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
