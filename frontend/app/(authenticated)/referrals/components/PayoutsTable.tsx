'use client';

import { History } from 'lucide-react';

import { formatRubles } from '@/domain/billing';
import {
  payoutStatusColor,
  payoutStatusLabel,
  type ReferralPayoutDomain,
} from '@/domain/referral';
import { Badge } from '@/ui/shadcn/badge';
import { Card } from '@/ui/shadcn/card';

interface Props {
  payouts: ReferralPayoutDomain[];
}

/**
 * PayoutsTable — история начислений партнёра.
 *
 * Без изменений по сравнению с предыдущей версией кабинета — только
 * стилизация под новую парную палитру `bg-{color} + text-{color}-fg`.
 */
export function PayoutsTable({ payouts }: Props) {
  if (payouts.length === 0) {
    return (
      <Card className="space-y-2 p-6">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
            aria-hidden="true"
          >
            <History className="h-4 w-4" />
          </span>
          <h2 className="text-base font-semibold text-fg-primary">
            История начислений
          </h2>
        </div>
        <p className="text-sm text-fg-secondary">
          Начисления появятся, когда твои клиенты сделают первую оплату.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-subtle px-6 py-4">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent"
          aria-hidden="true"
        >
          <History className="h-4 w-4" />
        </span>
        <h2 className="text-base font-semibold text-fg-primary">
          История начислений
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Период</th>
              <th className="px-6 py-3 text-left font-medium">Сумма</th>
              <th className="px-6 py-3 text-left font-medium">Статус</th>
              <th className="px-6 py-3 text-left font-medium">Создано</th>
              <th className="px-6 py-3 text-left font-medium">Выплачено</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-t border-border-subtle">
                <td className="px-6 py-3 font-mono text-fg-primary">
                  {p.periodMonth}
                </td>
                <td className="px-6 py-3 font-medium text-fg-primary">
                  {formatRubles(p.amountKopecks)}
                </td>
                <td className="px-6 py-3">
                  <Badge variant={badgeVariantFromColor(payoutStatusColor(p.status))}>
                    {payoutStatusLabel(p.status)}
                  </Badge>
                  {p.voidReason && (
                    <span className="ml-2 text-xs text-fg-tertiary">
                      {p.voidReason}
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-fg-secondary">
                  {p.createdAt.toLocaleDateString('ru-RU')}
                </td>
                <td className="px-6 py-3 text-fg-secondary">
                  {p.paidAt?.toLocaleDateString('ru-RU') ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function badgeVariantFromColor(
  c: 'green' | 'amber' | 'red',
): 'success' | 'warning' | 'danger' {
  if (c === 'green') return 'success';
  if (c === 'amber') return 'warning';
  return 'danger';
}
