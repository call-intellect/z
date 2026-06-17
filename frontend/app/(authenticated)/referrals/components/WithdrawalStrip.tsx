"use client";

import { Coins, TrendingUp, Users, Wallet } from "lucide-react";

import { formatRubles } from "@/domain/billing";
import type {
  MonthlyPointDomain,
  ReferralDomain,
  ReferralStatsDomain,
} from "@/domain/referral";
import { CHART, GRAD, StatCard } from "@/ui/components/dashboard/modern";

import { WithdrawButton } from "./WithdrawButton";

interface Props {
  referral: ReferralDomain;
  stats: ReferralStatsDomain;
  monthlyPoints?: MonthlyPointDomain[];
}

export function WithdrawalStrip({ referral, stats, monthlyPoints }: Props) {
  const monthlyEarningsKopecks = stats.activePaying * 20_000_00;

  const incomeSpark =
    monthlyPoints && monthlyPoints.length > 0
      ? monthlyPoints.map((p, i) => ({ i, v: p.incomeRub }))
      : undefined;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<Users className="h-5 w-5" />}
        grad={GRAD.blue}
        tone={CHART.blue}
        label="Активных клиентов"
        value={String(stats.activePaying)}
      />
      <StatCard
        icon={<TrendingUp className="h-5 w-5" />}
        grad={GRAD.teal}
        tone={CHART.teal}
        label="Доход в этом месяце"
        value={formatRubles(monthlyEarningsKopecks)}
        spark={incomeSpark}
      />
      <StatCard
        icon={<Coins className="h-5 w-5" />}
        grad={GRAD.amber}
        tone={CHART.amber}
        label="Всего заработано"
        value={formatRubles(stats.totalEarnedKopecks)}
      />
      <div className="flex flex-col gap-3">
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          grad={GRAD.violet}
          tone={CHART.violet}
          label="К выводу"
          value={formatRubles(stats.totalPendingKopecks)}
        />
        <WithdrawButton
          referral={referral}
          totalPendingKopecks={stats.totalPendingKopecks}
        />
      </div>
    </div>
  );
}
