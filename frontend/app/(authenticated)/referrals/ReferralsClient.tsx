'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Target, Wallet } from 'lucide-react';
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
  rewardProgressFromApi,
  type FunnelDomain,
  type FunnelPeriod,
  type MonthlyPointDomain,
  type ReferralClientMaskedDomain,
  type ReferralDomain,
  type ReferralPayoutDomain,
  type ReferralStatsDomain,
  type RewardProgressDomain,
} from '@/domain/referral';
import { useAuth } from '@/contexts/auth-context';
import {
  CHART,
  GaugeCard,
  GRAD,
  glass,
  ModernPageShell,
} from '@/ui/components/dashboard/modern';
import {
  LEADERSHIP_ROLES,
  normalizeRole,
} from '@/ui/components/app-shell/nav-config';
import { formatRubles } from '@/domain/billing';

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
      <ModernPageShell title="Партнёрская программа">
        <div className="space-y-5">
          <ShimmerBlock className="h-24" />
          <ShimmerBlock className="h-40" />
        </div>
      </ModernPageShell>
    );
  }

  if (referralError) {
    return (
      <ModernPageShell title="Партнёрская программа">
        <div className="space-y-4">
          <MarketingHero />
          <ErrorBlock error={referralError} />
        </div>
      </ModernPageShell>
    );
  }

  if (!referral) {
    return (
      <ModernPageShell title="Партнёрская программа">
        <div className="space-y-6">
          <MarketingHero />
          <CreateLinkCard onCreated={handleCreated} />
        </div>
      </ModernPageShell>
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
  const { currentOrgRole } = useAuth();
  const isLeader = LEADERSHIP_ROLES.includes(normalizeRole(currentOrgRole));

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

  // Reward-progress — данные гейджа «окупаемость» (те же, что у баннера B2/B3).
  const rewardSwr = useSWR(
    ['referrals-reward-progress', referral.id],
    async (): Promise<RewardProgressDomain> => {
      const api = await referralsApi.getRewardProgress();
      return rewardProgressFromApi(api);
    },
  );
  const reward = rewardSwr.data ?? null;

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
    <ModernPageShell title="Партнёрская программа">
      <div className="space-y-6">
        <MarketingHero compact />

        {statsSwr.error && <ErrorBlock error={statsSwr.error} />}

        {stats ? (
          <WithdrawalStrip
            referral={referral}
            stats={stats}
            monthlyPoints={isActiveCabinet ? chartPoints : undefined}
          />
        ) : (
          <ShimmerBlock className="h-28" />
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ReferralLinkCard
              referral={referral}
              hint={
                isActiveCabinet
                  ? null
                  : 'Поделись ссылкой — здесь появятся клики, регистрации и оплаты.'
              }
            />
          </div>
          <div>
            {stats ? (
              <PaybackGauge
                isLeader={isLeader}
                stats={stats}
                reward={reward}
              />
            ) : (
              <ShimmerBlock className="h-full min-h-[320px]" />
            )}
          </div>
        </div>

        {isActiveCabinet && (
          <>
            {funnel ? (
              <FunnelCard
                funnel={funnel}
                period={funnelPeriod}
                onPeriodChange={onFunnelPeriodChange}
              />
            ) : (
              <ShimmerBlock className="h-40" />
            )}

            {chartPoints.length > 0 ? (
              <IncomeChart points={chartPoints} />
            ) : (
              <ShimmerBlock className="h-72" />
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
    </ModernPageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PaybackGauge — гейдж «Окупаемость подписки» (B11)
// ─────────────────────────────────────────────────────────────────────

/**
 * Гейдж окупаемости (ТЗ B11). Руководителю показываем шкалу
 * «Окупаемость подписки» (активные клиенты → цель окупаемости), рядовому —
 * шкалу «Активных клиентов» (без цели окупаемости, max — текущий ориентир).
 *
 * Данные те же, что у баннера B2/B3 (`getRewardProgress`) — без новых
 * запросов сверх SWR. Пока reward не загрузился, опираемся на `stats`
 * (целевой максимум подставляем мягко, чтобы шкала была осмысленной).
 */
function PaybackGauge({
  isLeader,
  stats,
  reward,
}: {
  isLeader: boolean;
  stats: ReferralStatsDomain;
  reward: RewardProgressDomain | null;
}) {
  const monthlyEarnedKopecks = stats.activePaying * 20_000_00;

  if (isLeader) {
    // Цель окупаемости берём из reward-progress; пока не загрузилось —
    // безопасный ориентир (минимум 1, чтобы шкала не делила на ноль).
    const target = Math.max(1, reward?.targetClients ?? stats.activePaying);
    return (
      <GaugeCard
        title="Окупаемость подписки"
        icon={<Target className="h-4 w-4" />}
        grad={GRAD.violet}
        value={stats.activePaying}
        max={target}
        footer={[
          { t: 'Активных', v: String(stats.activePaying), c: CHART.mint },
          { t: 'Цель', v: String(reward?.targetClients ?? target), c: CHART.amber },
          { t: 'Доход', v: formatRubles(monthlyEarnedKopecks), c: CHART.violet },
        ]}
      />
    );
  }

  // Рядовой сотрудник — шкала «Активных клиентов».
  const target = Math.max(1, reward?.targetClients ?? stats.activePaying);
  return (
    <GaugeCard
      title="Активных клиентов"
      icon={<Wallet className="h-4 w-4" />}
      grad={GRAD.teal}
      value={stats.activePaying}
      max={target}
      footer={[
        { t: 'Активных', v: String(stats.activePaying), c: CHART.mint },
        { t: 'Цель', v: String(reward?.targetClients ?? target), c: CHART.amber },
        { t: 'Доход', v: formatRubles(monthlyEarnedKopecks), c: CHART.violet },
      ]}
    />
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
    <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{message}</div>
    </div>
  );
}

/**
 * Шиммер-плейсхолдер в новом визуальном языке: стеклянная поверхность
 * (`glass()`) + анимация `z-shimmer`. Заменяет старый shadcn `Skeleton`,
 * который рисовал плоский серый прямоугольник вне modern-стиля.
 */
function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div
      style={glass()}
      className={`z-shimmer rounded-[22px] ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}
