'use client';

import { Network } from 'lucide-react';
import useSWR from 'swr';

import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import { fromPromiseNetworkApi } from '@/domain/promise-network';
import { CardTitle, CHART, GlassCard, GRAD } from '@/ui/components/dashboard/modern';

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
      {data && data.hasData && accumulators.length > 0 ? (
        <p className="mt-1 text-xs" style={{ color: CHART.faint }}>
          в сети {accumulators.length} связанных
        </p>
      ) : null}
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
