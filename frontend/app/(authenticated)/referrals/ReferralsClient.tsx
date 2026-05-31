'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { referralsApi } from '@/api/referrals.api';
import {
  funnelFromApi,
  monthlyPointFromApi,
  referralClientMaskedFromApi,
  referralFromApi,
  referralPayoutFromApi,
  referralStatsFromApi,
  type FunnelDomain,
  type FunnelPeriod,
  type MonthlyPointDomain,
  type ReferralClientMaskedDomain,
  type ReferralDomain,
  type ReferralPayoutDomain,
  type ReferralStatsDomain,
} from '@/domain/referral';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { ClientsTableMasked } from './components/ClientsTableMasked';
import { CreateLinkCard } from './components/CreateLinkCard';
import { FunnelCard } from './components/FunnelCard';
import { IncomeChart } from './components/IncomeChart';
import { MarketingHero } from './components/MarketingHero';
import { PayoutDetailsCard } from './components/PayoutDetailsCard';
import { PayoutsTable } from './components/PayoutsTable';
import { ReferralLinkCard } from './components/ReferralLinkCard';
import { WithdrawalStrip } from './components/WithdrawalStrip';

/**
 * `/referrals` — кабинет партнёра Коры (полная переделка по ТЗ
 * 2026-05-31-referrals-cabinet-revamp Фаза 2).
 *
 * Три состояния (§8.1):
 *   A (`referral === null`) — профиля нет. Маркетинговый герой + одна
 *      карточка «Получи ссылку» с чекбоксом оферты. Реквизиты и ИНН не
 *      требуются на этом шаге (главное — снять барьер входа).
 *   B (профиль есть, ссылка свежая, `stats.clicks30d === 0`) — верхняя
 *      полоса с нулевыми плитками, карточка ссылки + QR, карточка
 *      реквизитов (статус «не заполнены»). Графики и таблицы не
 *      показываем — там пусто.
 *   C (профиль активен, `stats.clicks30d > 0`) — всё из B + воронка +
 *      график 12 месяцев + таблица клиентов (маскированная) + история
 *      начислений.
 *
 * Терминология (§9.1): везде «партнёр», «партнёрская ссылка», «оплата
 * клиента». Никаких `paid` / `lead` / `referral` в UI-копи.
 */
export function ReferralsClient() {
  const [funnelPeriod, setFunnelPeriod] = useState<FunnelPeriod>('30d');

  const referralSwr = useSWR(['referrals-me'], async () => {
    const api = await referralsApi.getMe();
    return api ? referralFromApi(api) : null;
  });
  const referral = referralSwr.data ?? null;
  const referralLoading = referralSwr.isLoading;
  const referralError = referralSwr.error;

  const handleCreated = useCallback(
    (created: ReferralDomain) => {
      void referralSwr.mutate(created, false);
    },
    [referralSwr],
  );

  const handleReferralUpdated = useCallback(
    (updated: ReferralDomain) => {
      void referralSwr.mutate(updated, false);
    },
    [referralSwr],
  );

  // ── Состояние A: загрузка ──
  if (referralLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5 p-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (referralError) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
        <MarketingHero />
        <ErrorBlock error={referralError} />
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
        <MarketingHero />
        <CreateLinkCard onCreated={handleCreated} />
      </div>
    );
  }

  // ── Состояния B / C ──
  return (
    <ReferralCabinet
      referral={referral}
      funnelPeriod={funnelPeriod}
      onFunnelPeriodChange={setFunnelPeriod}
      onReferralUpdated={handleReferralUpdated}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// ReferralCabinet — состояния B и C
// ─────────────────────────────────────────────────────────────────────

interface CabinetProps {
  referral: ReferralDomain;
  funnelPeriod: FunnelPeriod;
  onFunnelPeriodChange: (p: FunnelPeriod) => void;
  onReferralUpdated: (referral: ReferralDomain) => void;
}

function ReferralCabinet({
  referral,
  funnelPeriod,
  onFunnelPeriodChange,
  onReferralUpdated,
}: CabinetProps) {
  // Stats — нужны для решения B vs C (clicks30d > 0?), а также для
  // верхней полосы плиток.
  const statsSwr = useSWR(
    ['referrals-stats', referral.id],
    async (): Promise<ReferralStatsDomain | null> => {
      const api = await referralsApi.getStats();
      return api ? referralStatsFromApi(api) : null;
    },
  );
  const stats = statsSwr.data ?? null;

  // Payouts — история начислений (показываем во всех состояниях B/C).
  const payoutsSwr = useSWR(
    ['referrals-payouts', referral.id],
    async (): Promise<ReferralPayoutDomain[]> => {
      const api = await referralsApi.getMyPayouts();
      return api.map(referralPayoutFromApi);
    },
  );
  const payouts = payoutsSwr.data ?? [];

  const isActiveCabinet = useMemo(
    () => (stats?.clicks30d ?? 0) > 0,
    [stats?.clicks30d],
  );

  // Тяжёлые данные (chart, funnel, clients) запрашиваем только когда
  // состояние C — `stats.clicks30d > 0`. SWR-ключ `null` пропускает запрос.
  const chartSwr = useSWR(
    isActiveCabinet ? ['referrals-income-chart', referral.id] : null,
    async (): Promise<MonthlyPointDomain[]> => {
      const api = await referralsApi.getIncomeChart();
      return api.map(monthlyPointFromApi);
    },
  );
  const chartPoints = chartSwr.data ?? [];

  const funnelSwr = useSWR(
    isActiveCabinet
      ? ['referrals-funnel', referral.id, funnelPeriod]
      : null,
    async (): Promise<FunnelDomain | null> => {
      const api = await referralsApi.getFunnel(funnelPeriod);
      return api ? funnelFromApi(api) : null;
    },
  );
  const funnel = funnelSwr.data ?? null;

  const clientsSwr = useSWR(
    isActiveCabinet ? ['referrals-clients', referral.id] : null,
    async (): Promise<ReferralClientMaskedDomain[]> => {
      const api = await referralsApi.getMyClients();
      return api.map(referralClientMaskedFromApi);
    },
  );
  const clients = clientsSwr.data ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <MarketingHero compact />

      {statsSwr.error && <ErrorBlock error={statsSwr.error} />}

      {stats ? (
        <WithdrawalStrip referral={referral} stats={stats} />
      ) : (
        <Skeleton className="h-24" />
      )}

      <ReferralLinkCard
        referral={referral}
        hint={
          isActiveCabinet
            ? null
            : 'Поделись ссылкой — здесь появятся клики, регистрации и оплаты.'
        }
      />

      {isActiveCabinet && (
        <>
          {funnel ? (
            <FunnelCard
              funnel={funnel}
              period={funnelPeriod}
              onPeriodChange={onFunnelPeriodChange}
            />
          ) : (
            <Skeleton className="h-40" />
          )}

          {chartPoints.length > 0 ? (
            <IncomeChart points={chartPoints} />
          ) : (
            <Skeleton className="h-72" />
          )}

          <ClientsTableMasked clients={clients} />
        </>
      )}

      <PayoutDetailsCard
        referral={referral}
        onUpdated={onReferralUpdated}
      />

      <PayoutsTable payouts={payouts} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────

function ErrorBlock({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : 'Не удалось загрузить данные кабинета.';
  return (
    <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{message}</div>
    </div>
  );
}
