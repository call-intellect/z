'use client';

import { ChevronRight, Filter } from 'lucide-react';

import {
  funnelConversion,
  funnelPeriodLabel,
  type FunnelDomain,
  type FunnelPeriod,
} from '@/domain/referral';
import { Card } from '@/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

interface Props {
  funnel: FunnelDomain;
  period: FunnelPeriod;
  onPeriodChange: (p: FunnelPeriod) => void;
}

/**
 * FunnelCard — воронка партнёра за выбранный период (ТЗ §8.1 C).
 *
 * 4 строки:
 *   1. Кликов  (без конверсии).
 *   2. Регистраций  + % от кликов.
 *   3. Первых оплат + % от регистраций.
 *   4. Активных сейчас + % от первых оплат.
 *
 * Период выбирается селектом (30d / 90d / all) — это передаётся в SWR-ключ
 * родителем (`ReferralsClient`), поэтому смена периода триггерит refetch.
 */
export function FunnelCard({ funnel, period, onPeriodChange }: Props) {
  const rows = funnelConversion(funnel);

  return (
    <Card className="space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
            aria-hidden="true"
          >
            <Filter className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-fg-primary">
              Воронка партнёра
            </h2>
            <p className="text-xs text-fg-tertiary">
              От кликов по ссылке до активных клиентов сейчас.
            </p>
          </div>
        </div>
        <Select
          value={period}
          onValueChange={(v) => onPeriodChange(v as FunnelPeriod)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={funnelPeriodLabel(period)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">{funnelPeriodLabel('30d')}</SelectItem>
            <SelectItem value="90d">{funnelPeriodLabel('90d')}</SelectItem>
            <SelectItem value="all">{funnelPeriodLabel('all')}</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {rows.map((row, idx) => (
          <div
            key={row.key}
            className="rounded-md border border-border-subtle bg-bg-base/40 p-4"
          >
            <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-fg-tertiary">
              {idx > 0 && (
                <ChevronRight
                  className="h-3 w-3 shrink-0 text-fg-tertiary"
                  aria-hidden="true"
                />
              )}
              <span>{row.label}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold text-fg-primary">
              {row.value}
            </div>
            <div className="mt-1 h-4 text-xs text-fg-secondary">
              {row.conversionPercent !== null
                ? `${row.conversionPercent}% от предыдущего`
                : ' '}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
