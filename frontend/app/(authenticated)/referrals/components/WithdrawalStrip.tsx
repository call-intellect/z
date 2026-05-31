'use client';

import { TrendingUp, Users, Wallet } from 'lucide-react';

import { formatRubles } from '@/domain/billing';
import type { ReferralDomain, ReferralStatsDomain } from '@/domain/referral';
import { Card } from '@/ui/shadcn/card';

import { WithdrawButton } from './WithdrawButton';

interface Props {
  referral: ReferralDomain;
  stats: ReferralStatsDomain;
}

/**
 * WithdrawalStrip — верхняя «полоса» из трёх плиток + кнопка «Вывести».
 *
 * Состояния B и C (ТЗ §8.1). В состоянии B все значения нулевые —
 * это нормальное «свежий партнёр», текст плиток не меняется.
 *
 * Плитки:
 *   1. Активных клиентов сейчас.
 *   2. Доход в этом месяце (`activePaying × 20 000 ₽` — фиксированная
 *      комиссия, считается клиентом без отдельного запроса).
 *   3. К выводу — `totalPendingKopecks`.
 */
export function WithdrawalStrip({ referral, stats }: Props) {
  /**
   * Доход в этом месяце = активные клиенты × 20 000 ₽. Это совпадает с
   * логикой `getStats.monthlyEarningsKopecks` на backend (фиксированная
   * комиссия 20 000 ₽ на клиента, ТЗ §7.2). Считаем на клиенте без
   * лишнего запроса.
   */
  const monthlyEarningsKopecks = stats.activePaying * 20_000_00;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        icon={<Users className="h-4 w-4" />}
        label="Активных клиентов"
        value={String(stats.activePaying)}
      />
      <Tile
        icon={<TrendingUp className="h-4 w-4" />}
        label="Доход в этом месяце"
        value={formatRubles(monthlyEarningsKopecks)}
      />
      <Tile
        icon={<Wallet className="h-4 w-4" />}
        label="К выводу"
        value={formatRubles(stats.totalPendingKopecks)}
      />
      <Card className="flex flex-col justify-between gap-2 p-4">
        <span className="text-xs uppercase tracking-wide text-fg-tertiary">
          Действие
        </span>
        <WithdrawButton
          referral={referral}
          totalPendingKopecks={stats.totalPendingKopecks}
        />
      </Card>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-tertiary">
        <span className="text-fg-secondary" aria-hidden="true">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className="text-2xl font-semibold text-fg-primary">{value}</div>
    </Card>
  );
}
