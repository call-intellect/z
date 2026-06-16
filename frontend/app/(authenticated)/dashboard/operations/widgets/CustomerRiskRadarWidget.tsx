'use client';

import { TrendingDown } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import {
  fromCustomerRiskListApi,
  type CustomerRiskLevel,
} from '@/domain/customer-risk';
import { CardTitle, CHART, GlassCard, GRAD, StatusPill } from '@/ui/components/dashboard/modern';

/**
 * ТЗ coo-orphan-agents Ф4 — виджет «Клиенты под риском оттока» на доске
 * `/dashboard/operations`. Self-fetch через SWR на
 * `operationsDashboardApi.getCustomerRisk({ limit: 20 })` (`.catch`-safe).
 *
 * Карточки некликабельны (drill-down на клиента неоднозначен) — показываем hint.
 * Имена клиентов под риском видят только owner/admin/coo — эндпоинт гейтит
 * доступ, виджет монтируется только на COO-доске.
 */

const LEVEL_TONE: Record<CustomerRiskLevel, 'ok' | 'warning' | 'risk'> = {
  critical: 'risk',
  warning: 'warning',
  ok: 'ok',
};

export function CustomerRiskRadarWidget() {
  const [showAll, setShowAll] = useState(false);
  const swr = useSWR(
    ['operations-customer-risk', 20],
    () => operationsDashboardApi.getCustomerRisk({ limit: 20 }).catch(() => null),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const items = swr.data ? fromCustomerRiskListApi(swr.data) : null;
  const visible = items ? (showAll ? items : items.slice(0, 5)) : [];

  return (
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<TrendingDown size={16} />} grad={GRAD.pink}>
          Клиенты под риском оттока
        </CardTitle>
        {swr.data ? (
          <span className="text-xs" style={{ color: CHART.faint }}>
            критичных {swr.data.criticalCount} · под вниманием {swr.data.warningCount}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {swr.isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>Загрузка…</p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Клиентов под риском нет — сигналов оттока за период не зафиксировано.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {visible.map((c) => (
                <li
                  key={c.id}
                  className="rounded-xl p-3"
                  style={{ background: 'var(--surface-inset)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex-1 text-sm font-medium" style={{ color: CHART.text }}>
                      {c.customerName}
                    </span>
                    <StatusPill status={LEVEL_TONE[c.riskLevel]} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: CHART.faint }}>
                    {c.topSignalBadge ? <span>{c.topSignalBadge}</span> : null}
                    {c.scoreDelta > 0 ? (
                      <span style={{ color: CHART.red }}>приток риска</span>
                    ) : c.scoreDelta < 0 ? (
                      <span style={{ color: CHART.mint }}>риск спадает</span>
                    ) : null}
                    {c.responsiblePersonName ? <span>ответственный: {c.responsiblePersonName}</span> : null}
                  </div>
                  {c.hint ? (
                    <p className="mt-1.5 text-xs" style={{ color: CHART.dim }}>{c.hint}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {items.length > 5 ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 text-xs hover:underline"
                style={{ color: CHART.cyan }}
              >
                {showAll ? 'Свернуть' : `Показать всех (${items.length})`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </GlassCard>
  );
}
