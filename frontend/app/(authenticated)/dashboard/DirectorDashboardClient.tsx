'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import useSWR from 'swr';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Brain,
  HelpCircle,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { dashboardApi } from '@/api/dashboard.api';
import { orgsApi } from '@/api/orgs.api';
import { useAuth } from '@/contexts/auth-context';
import { useSubscription } from '@/contexts/subscription-context';
import { useDashboardTab } from '@/hooks/useDashboardTab';
import { useMemberships } from '@/hooks/useMemberships';
import {
  pulsePatternsFromApi,
  type PulsePatternsDomain,
} from '@/domain/pulse-patterns';
import {
  THEME_BRANCH_LABELS,
  type ThemeBranch,
} from '@/domain/theme';
import {
  SIGNAL_COUNTERS_BUCKET_COLORS,
  SIGNAL_COUNTERS_BUCKET_LABELS,
  SIGNAL_COUNTERS_BUCKET_ORDER,
  directorDashboardFromApi,
  entityTypeLabel,
  signalTypeLabel,
  type DirectorDashboardDomain,
  type DirectorDashboardEntityDomain,
  type DirectorDashboardOpenQuestionDomain,
  type DirectorDashboardPeriod,
  type DirectorDashboardSignalCountersDomain,
  type DirectorDashboardSignalDomain,
  type DirectorDashboardThemeDomain,
} from '@/domain/director-dashboard';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';
import { ActivityFeedWidget } from '@/ui/components/dashboard/ActivityFeedWidget';
import { AiNarrativeWithSources } from '@/ui/components/dashboard/AiNarrativeWithSources';
import { MainEmptyState } from '@/ui/components/dashboard/MainEmptyState';
// Pulse Wave 6 — 7 виджетов паттернов на главной директора.
import { BottleneckHeatmapWidget } from '@/ui/components/dashboard/BottleneckHeatmapWidget';
import { BusFactorWidget } from '@/ui/components/dashboard/BusFactorWidget';
import { DashboardTabs } from '@/ui/components/dashboard/DashboardTabs';
import { GoalVectorWidget } from '@/ui/components/dashboard/GoalVectorWidget';
import { IrreversibleDecisionsAlert } from '@/ui/components/dashboard/IrreversibleDecisionsAlert';
import { KnowledgeVelocityKpi } from '@/ui/components/dashboard/KnowledgeVelocityKpi';
import { LowRoiMeetingsWidget } from '@/ui/components/dashboard/LowRoiMeetingsWidget';
import { PeopleAtRiskWidget } from '@/ui/components/dashboard/PeopleAtRiskWidget';
import { RecurringTopicsWidget } from '@/ui/components/dashboard/RecurringTopicsWidget';
import { TabEmptyState } from '@/ui/components/dashboard/TabEmptyState';
import { TeamHealthGrid } from '@/ui/components/dashboard/TeamHealthGrid';
import { TopRiskCard } from '@/ui/components/dashboard/TopRiskCard';
import { KpiHero } from '@/ui/components/shared/KpiHero';
import { InsightsTopWidget } from './widgets/InsightsTopWidget';
import { IntroWizardWidget } from './widgets/IntroWizardWidget';
import { QualityScoreWidget } from './widgets/QualityScoreWidget';
import { StrategicAlignmentWidget } from './widgets/StrategicAlignmentWidget';
import { StructureSummaryWidget } from './widgets/StructureSummaryWidget';

/**
 * Дашборд директора (knowledge-core, Фаза 8).
 *
 * Источник правды: `GET /api/v1/dashboard/director?period=week|month`
 * (см. `backend/src/modules/dashboard/`).
 *
 * Доступ: owner / admin / super_admin. Splitting роли на manager-вид и
 * директорский вид делается выше — в `dashboard/page.tsx`.
 *
 * Структура:
 *   - Header с приветствием, переключателем периода и «Обновить».
 *   - Опциональная narrativeSummary (LLM-сводка «Главное за период»).
 *   - 5 виджетов на сетке: новые темы+сигналы, счётчики сигналов,
 *     активные темы, главные сущности, открытые вопросы.
 *   - Org-chat вынесен из главной в AssistantSidebar (Б.4 ТЗ tabs-restructure).
 *   - Зарезервировано место для виджета «Согласованность стратегии» (Phase 9).
 */
export function DirectorDashboardClient() {
  const { user, currentOrgId, currentOrgRole } = useAuth();
  const { activeTab, setActiveTab } = useDashboardTab(user?.id ?? null);
  const { memberships } = useMemberships();
  const { status: subscriptionStatus, loading: subscriptionLoading, showPaywallModal } =
    useSubscription();
  const [period, setPeriod] = useState<DirectorDashboardPeriod>('week');
  const [data, setData] = useState<DirectorDashboardDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pulse Wave 6 — паттерны (7 виджетов) грузим параллельно с основным DTO.
  // Ошибка в любом из запросов не валит другой.
  const [pulse, setPulse] = useState<PulsePatternsDomain | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [pulseError, setPulseError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPeriod: DirectorDashboardPeriod) => {
      if (!currentOrgId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await dashboardApi.getDirectorView(currentOrgId, nextPeriod);
        setData(directorDashboardFromApi(res));
      } catch (e) {
        const message =
          e instanceof ApiError ? e.message : 'Не удалось загрузить дашборд';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [currentOrgId],
  );

  const loadPulse = useCallback(
    async (nextPeriod: DirectorDashboardPeriod) => {
      if (!currentOrgId) return;
      setPulseLoading(true);
      setPulseError(null);
      try {
        const res = await dashboardApi.getPulsePatterns(currentOrgId, nextPeriod);
        setPulse(pulsePatternsFromApi(res));
      } catch (e) {
        const message =
          e instanceof ApiError
            ? e.message
            : 'Не удалось загрузить паттерны';
        setPulseError(message);
      } finally {
        setPulseLoading(false);
      }
    },
    [currentOrgId],
  );

  useEffect(() => {
    if (!currentOrgId) return;
    void load(period);
    void loadPulse(period);
  }, [period, load, loadPulse, currentOrgId]);

  const greetingName = useMemo(() => {
    return user?.name?.trim() || user?.email?.split('@')[0] || 'друг';
  }, [user]);

  const periodLabel = period === 'week' ? 'неделю' : 'месяц';

  // ─── Матрица 6 состояний (Шаг В.1+В.2+В.3 зонтика ─────────────────────────
  // `2026-06-01-main-screen-umbrella.md`).
  // Org.isReferenceDemo + currentOrgRole + subscriptionStatus + data.isEmpty.
  const currentMembership = useMemo(
    () => memberships.find((m) => m.id === currentOrgId) ?? null,
    [memberships, currentOrgId],
  );
  // Если memberships ещё не загружены — считаем что своя Org (консервативный
  // дефолт, чтобы не показать MainEmptyState вместо эталонного flow).
  const isOwnOrg = currentMembership ? !currentMembership.isReferenceDemo : true;
  const isOwnerOrAdmin = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  // Состояние 3 матрицы: своя Org, DEMO-подписка, owner/admin, нет данных.
  const isPageEmpty =
    isOwnOrg &&
    subscriptionStatus === 'DEMO' &&
    isOwnerOrAdmin &&
    !loading &&
    !subscriptionLoading &&
    (data?.isEmpty === true || data === null);

  // Есть ли эталон в memberships → можно ли предложить «Вернуться в демо».
  const referenceMembership = useMemo(
    () => memberships.find((m) => m.isReferenceDemo) ?? null,
    [memberships],
  );
  const canReturnToDemo = !!referenceMembership;
  const handleReturnToDemo = useCallback(() => {
    if (typeof window === 'undefined' || !referenceMembership) return;
    // OrgSwitcher fallback использует тот же ключ — после reload активная Org
    // подхватится из cookie/localStorage.
    window.localStorage.setItem('z.activeOrgId', referenceMembership.id);
    window.location.href = '/dashboard';
  }, [referenceMembership]);

  // Прогресс настройки компании — только для owner/admin (Шаг В.3 + правило 5
  // матрицы: онбординг скрыт для member). Дублируем countCompleted из
  // IntroWizardWidget, чтобы не плодить cross-import — это 6 строк.
  const orgSwr = useSWR(
    isPageEmpty && isOwnerOrAdmin && currentOrgId
      ? ['main-empty-org', currentOrgId]
      : null,
    () => orgsApi.byId(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const setupProgress = useMemo(() => {
    if (!isOwnerOrAdmin) return undefined;
    const org = orgSwr.data?.org as
      | {
          welcomeCompletedAt?: string | null;
          companyInfoCompletedAt?: string | null;
          departmentsCompletedAt?: string | null;
          rolesCompletedAt?: string | null;
          teamInvitedAt?: string | null;
          firstMeetingCreatedAt?: string | null;
          firstSprintCreatedAt?: string | null;
        }
      | undefined;
    if (!org) return undefined;
    let n = 0;
    if (org.welcomeCompletedAt) n++;
    if (org.companyInfoCompletedAt) n++;
    if (org.departmentsCompletedAt) n++;
    if (org.rolesCompletedAt) n++;
    if (org.teamInvitedAt) n++;
    if (org.firstMeetingCreatedAt || org.firstSprintCreatedAt) n++;
    return { completed: n, total: 6 };
  }, [orgSwr.data, isOwnerOrAdmin]);

  // Static smoke матрицы 6 состояний (Шаг В.6 зонтика main-screen-umbrella):
  // 1. Эталон + demo_observer → isOwnOrg=false → !isPageEmpty → Hero+Tabs.
  //    isReadOnlyDemo=true (TopRiskCard prop) → CTA «Открыть» + «+ ещё N»
  //    рендерятся как <button onClick={showPaywallModal}>, не <Link>.
  // 2. Эталон + super_admin → isReferenceDemo=true, но role не demo_observer →
  //    Hero+Tabs полные, CTA активны (DemoObserverGuard bypass на backend).
  // 3. Своя + owner/admin + DEMO + isEmpty → isPageEmpty=true → MainEmptyState
  //    замещает Hero+Tabs (см. ниже).
  // 4. Своя + owner/admin + ACTIVE → status≠'DEMO' → !isPageEmpty → Hero+Tabs.
  //    Per-таб empty-state из TabEmptyState (Фаза Б.6).
  // 5. Своя + member + ACTIVE → isOwnerOrAdmin=false → !isPageEmpty →
  //    Hero+Tabs. IntroWizardWidget сам себя скрывает (member-check внутри).
  // 6. Своя + owner + ACTIVE без demo_observer → как №4.
  //
  // Ранний return: MainEmptyState замещает Hero+Tabs целиком.
  if (isPageEmpty) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <MainEmptyState
          canReturnToDemo={canReturnToDemo}
          onReturnToDemo={handleReturnToDemo}
          setupProgress={setupProgress}
        />
      </div>
    );
  }

  // Stagger-делей для enter-анимации секций. Cap 400ms (см. §4.6 ТЗ).
  // Анимация выполняется один раз на mount через `animate-in` + `fill-mode: backwards`.
  let staggerStep = 0;
  const nextStagger = () => {
    const ms = Math.min(staggerStep * 60, 400);
    staggerStep += 1;
    return ms;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
      {/* Б.8 — снят sticky, чтобы не конфликтовать с sticky Hero (top-0 z-20).
          Header теперь обычный, скроллится за Hero. */}
      <header className="-mx-4 mb-6 flex flex-col gap-3 border-b border-border-subtle/50 px-4 py-3 md:-mx-6 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Привет, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Срез знаний компании за {periodLabel}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* §5.5 — Pill-ссылка на операционную сводку. */}
          <Link
            href="/dashboard/operations"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-bg-overlay/60 px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-bg-overlay hover:text-fg-primary"
            aria-label="Открыть операционную сводку"
          >
            <Activity size={14} strokeWidth={1.75} className="shrink-0" />
            <span>Операционная сводка</span>
          </Link>
          <PeriodSwitch value={period} onChange={setPeriod} disabled={loading} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(period)}
            disabled={loading}
            aria-label="Обновить"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCcw size={14} />
            )}
            <span className="ml-1.5">Обновить</span>
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg shadow-card-soft">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* === STICKY HERO (3 зоны: 3 KPI · AI-сводка · Топ-1 риск) ===
          Фаза Б.2 ТЗ `2026-06-01-dashboard-main-tabs-restructure.md`. */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 bg-gradient-to-br from-bg-base via-bg-base to-accent/5 px-4 pb-3 pt-3 backdrop-blur md:pt-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Зона 1: 3 KPI с MiniSparkline. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:col-span-1">
            <KpiHero
              label="Настроение"
              value={data?.kpiSentimentIndex?.value ?? 0}
              numericValue={data?.kpiSentimentIndex?.value ?? 0}
              sparkline={data?.kpiSentimentIndex?.sparkline}
              trend={data?.kpiSentimentIndex?.trend}
              threshold={{ green: 30, yellow: 0 }}
              href="/dashboard/operations"
            />
            <KpiHero
              label="Обещания"
              value={`${data?.kpiCommitmentReliability?.value ?? 0}%`}
              numericValue={data?.kpiCommitmentReliability?.value ?? 0}
              format={(n) => `${Math.round(n)}%`}
              sparkline={data?.kpiCommitmentReliability?.sparkline}
              delta={data?.kpiCommitmentReliability?.delta}
              deltaLabel="за 14 дней"
              threshold={{ green: 80, yellow: 60 }}
              href="/me/promises"
            />
            <KpiHero
              label="Висящие решения"
              value={data?.kpiHangingDecisions?.value ?? 0}
              numericValue={data?.kpiHangingDecisions?.value ?? 0}
              sparkline={data?.kpiHangingDecisions?.sparkline}
              threshold={{ green: 2, yellow: 5, inverted: true }}
              href="/decisions?status=hanging"
            />
          </div>

          {/* Зона 2: AI-сводка. */}
          <div className="rounded-2xl border border-accent/20 bg-bg-card p-4 shadow-lg shadow-accent/15">
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-accent-fg">
              <Sparkles size={12} aria-hidden />
              <span>AI-сводка</span>
            </div>
            {data?.narrativeSummary ? (
              <AiNarrativeWithSources data={data.narrativeSummary} periodLabel={periodLabel} />
            ) : (
              <p className="text-xs text-fg-tertiary">AI-сводка появится после первой встречи или анализа знаний.</p>
            )}
          </div>

          {/* Зона 3: Топ-1 риск. */}
          <TopRiskCard
            risk={
              pulse?.irreversibleDecisions?.decisions?.[0]
                ? {
                    id: pulse.irreversibleDecisions.decisions[0].decisionId,
                    title: pulse.irreversibleDecisions.decisions[0].statement,
                    subtitle: null,
                  }
                : null
            }
            totalCount={pulse?.irreversibleDecisions?.alertCount ?? 0}
            isReadOnlyDemo={(currentOrgRole as string | null) === 'demo_observer'}
            onPaywallTrigger={showPaywallModal}
          />
        </div>
      </div>

      {/* === Узкая sticky-полоса под Hero: структура + «Спросите Кору» === */}
      <div className="sticky top-[var(--hero-h,200px)] z-10 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 bg-bg-base/95 px-4 py-2 backdrop-blur">
        <div className="min-w-0 flex-1">
          <StructureSummaryWidget />
        </div>
        <button
          type="button"
          onClick={() => {
            // TODO Б.4: открыть AssistantSidebar на табе «Спросить».
            // Пока заглушка — для Б.2 достаточно UI-плейсхолдера.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('assistant-sidebar:open-ask'));
            }
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-3.5 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <MessageCircle size={14} strokeWidth={1.75} />
          Спросите Кору
        </button>
      </div>

      {/* Онбординг-блок (Б.5 — рефактор логики; пока оставляем как есть). */}
      <StaggerSection delayMs={nextStagger()}>
        <div className="mb-6">
          <IntroWizardWidget />
        </div>
      </StaggerSection>

      {/* === Sticky tabs под Hero === */}
      <div className="sticky top-[var(--hero-tabs-top,260px)] z-10 -mx-4 mb-4 bg-bg-base/95 px-4 pt-1 backdrop-blur">
        <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* === Контент активного таба === */}
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
        {activeTab === 'overview' && (
          <OverviewTab
            data={data}
            pulse={pulse}
            loading={loading}
            pulseLoading={pulseLoading}
            pulseError={pulseError}
            periodLabel={periodLabel}
          />
        )}
        {activeTab === 'team' && (
          <TeamTab
            data={data}
            pulse={pulse}
            loading={loading}
            pulseLoading={pulseLoading}
            pulseError={pulseError}
          />
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeTab
            data={data}
            pulse={pulse}
            loading={loading}
            pulseLoading={pulseLoading}
            pulseError={pulseError}
            periodLabel={periodLabel}
          />
        )}
        {activeTab === 'goals' && (
          <GoalsTab
            pulse={pulse}
            data={data}
            loading={loading}
            pulseLoading={pulseLoading}
            pulseError={pulseError}
          />
        )}
      </div>
    </div>
  );
}

// ─── §4.6 StaggerSection — обёртка для enter-анимации виджетов. ──────────────
// `motion-safe:` уважает prefers-reduced-motion. fill-mode: backwards через
// tailwindcss-animate гарантирует один прогон на mount без повторов.

function StaggerSection({
  children,
  delayMs,
}: {
  children: ReactNode;
  delayMs: number;
}) {
  return (
    <div
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-backwards"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

// ─── Tab contents (Фаза 3 ТЗ 2026-06-01-dashboard-main-tabs-restructure) ────

type TabContentProps = {
  data: DirectorDashboardDomain | null;
  pulse: PulsePatternsDomain | null;
  loading: boolean;
  pulseLoading: boolean;
  pulseError: string | null;
  periodLabel?: string;
};

function OverviewTab({ data, pulse, loading, pulseLoading }: TabContentProps) {
  const themes = data?.newThemes ?? [];
  const signals = data?.newSignals ?? [];
  const decisions = (pulse?.irreversibleDecisions?.decisions ?? []).slice(0, 3);
  const allEmpty =
    !loading &&
    !pulseLoading &&
    themes.length === 0 &&
    signals.length === 0 &&
    decisions.length === 0;
  if (allEmpty) {
    return (
      <TabEmptyState
        tabLabel="Обзор"
        icon={LayoutDashboard}
        hint="Дайджест недели заполнится после первой встречи или появления тем."
      />
    );
  }
  return (
    <StaggerSection delayMs={0}>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DigestCard
          title="Темы недели"
          items={themes.slice(0, 3).map((t) => ({ id: t.id, label: t.name }))}
          href="/themes"
          emptyLabel="Новых тем пока нет"
        />
        <DigestCard
          title="Сигналы недели"
          items={signals.slice(0, 3).map((s) => ({ id: s.id, label: s.name }))}
          href="/insights"
          emptyLabel="Новых сигналов пока нет"
        />
        <DigestCard
          title="Решения недели"
          items={decisions.map((d) => ({ id: d.decisionId, label: d.statement }))}
          href="/decisions"
          emptyLabel="Свежих решений пока нет"
        />
      </div>
      <TabBottomLink href="/themes" label="Открыть полный раздел «Память компании» →" />
    </StaggerSection>
  );
}

function TeamTab({ pulse, pulseLoading, pulseError }: TabContentProps) {
  return (
    <StaggerSection delayMs={0}>
      <div className="mb-6">
        <TeamHealthGrid />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <BusFactorWidget
            data={pulse?.busFactor ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
        <div className="lg:col-span-2">
          <ActivityFeedWidget
            feedTypes={['probe_question']}
            scope="company"
            pageSize={5}
            liveUpdate
            drillDownHref="/me/notifications"
            title="Вопросы AI команде"
            emptyHint="Пока активных вопросов нет — Кора задаст их по мере появления данных."
          />
        </div>
      </div>
      {/* PeopleAtRiskWidget — Топ-3 сотрудника с низким Pulse. Пока endpoint
          /dashboard/people-at-risk не реализован — items=null → виджет скрыт.
          См. dashboards-registry §4.4 «Открытые хвосты». */}
      <div className="mb-6">
        <PeopleAtRiskWidget items={null} />
      </div>
      <TabBottomLink href="/teams" label="Открыть /teams →" />
    </StaggerSection>
  );
}

function KnowledgeTab({
  data,
  pulse,
  loading,
  pulseLoading,
  pulseError,
  periodLabel,
}: TabContentProps) {
  const themes = data?.newThemes ?? [];
  const entities = data?.hotEntities ?? [];
  const questions = data?.openQuestions ?? [];
  const allEmpty =
    !loading &&
    !pulseLoading &&
    !pulse?.recurringTopics &&
    !pulse?.bottlenecks &&
    themes.length === 0 &&
    entities.length === 0 &&
    questions.length === 0;
  if (allEmpty) {
    return (
      <TabEmptyState
        tabLabel="Знания"
        icon={Brain}
        hint="Раздел заполнится после первой встречи или загрузки документов — AI извлечёт темы и сущности."
      />
    );
  }
  return (
    <StaggerSection delayMs={0}>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <RecurringTopicsWidget
            data={pulse?.recurringTopics ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
        <div className="lg:col-span-2">
          <BottleneckHeatmapWidget
            data={pulse?.bottlenecks ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WhatLearnedWidget
          loading={loading}
          newThemes={data?.newThemes ?? []}
          newSignals={data?.newSignals ?? []}
          periodLabel={periodLabel ?? 'неделю'}
        />
        <SignalCountersWidget
          loading={loading}
          counters={data?.signalCounters ?? null}
        />
        <ActiveThemesWidget loading={loading} themes={data?.activeThemes ?? []} />
        <HotEntitiesWidget loading={loading} entities={data?.hotEntities ?? []} />
        <OpenQuestionsWidget
          loading={loading}
          questions={data?.openQuestions ?? []}
        />
        <InsightsTopWidget />
        <KnowledgeVelocityKpi data={pulse?.knowledgeVelocity ?? null} />
      </div>
      <TabBottomLink href="/themes" label="Открыть полный раздел «Память компании» →" />
    </StaggerSection>
  );
}

function GoalsTab({
  data,
  pulse,
  loading,
  pulseLoading,
  pulseError,
}: TabContentProps) {
  const meetingsCount = pulse?.lowRoiMeetings?.meetings?.length ?? 0;
  const decisionsCount = pulse?.irreversibleDecisions?.decisions?.length ?? 0;
  const allEmpty =
    !loading &&
    !pulseLoading &&
    !pulse?.goalVector &&
    meetingsCount === 0 &&
    decisionsCount === 0;
  if (allEmpty) {
    return (
      <TabEmptyState
        tabLabel="Цели и встречи"
        icon={Target}
        hint="Цели и решения появятся после фиксации первой стратегической встречи."
      />
    );
  }
  return (
    <StaggerSection delayMs={0}>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GoalVectorWidget
            data={pulse?.goalVector ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
        <div className="lg:col-span-1">
          <LowRoiMeetingsWidget
            meetings={pulse?.lowRoiMeetings.meetings ?? []}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
      </div>
      <div className="mb-6">
        <IrreversibleDecisionsAlert
          decisions={pulse?.irreversibleDecisions?.decisions ?? []}
          alertCount={pulse?.irreversibleDecisions?.alertCount ?? 0}
        />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StrategicAlignmentWidget
          data={data?.strategicAlignment}
          loading={loading}
        />
        <QualityScoreWidget />
      </div>
      <div className="flex flex-wrap gap-4">
        <TabBottomLink href="/goals" label="Открыть /goals →" />
        <TabBottomLink href="/meetings" label="Открыть /meetings →" />
      </div>
    </StaggerSection>
  );
}

function TabBottomLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center text-sm font-medium text-accent-fg transition-colors hover:underline"
    >
      {label}
    </Link>
  );
}

function DigestCard({
  title,
  items,
  href,
  emptyLabel,
}: {
  title: string;
  items: ReadonlyArray<{ id?: string; label?: string | null }>;
  href: string;
  emptyLabel: string;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-2xl border border-border-subtle/60 bg-bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-fg-tertiary">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={it.id ?? i} className="line-clamp-2 text-sm text-fg-primary">
              {it.label || '—'}
            </li>
          ))}
        </ul>
      )}
      <Link
        href={href}
        className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
      >
        Открыть
        <ArrowRight size={12} />
      </Link>
    </div>
  );
}

// ─── Period switch ──────────────────────────────────────────────────────────

function PeriodSwitch({
  value,
  onChange,
  disabled,
}: {
  value: DirectorDashboardPeriod;
  onChange: (p: DirectorDashboardPeriod) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border-subtle bg-bg-card p-0.5 text-sm">
      {(['week', 'month'] as const).map((p) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          onClick={() => onChange(p)}
          className={cn(
            'rounded-sm px-3 py-1 transition-colors',
            value === p
              ? 'bg-accent text-accent-fg'
              : 'text-fg-secondary hover:text-fg-primary',
            disabled && 'opacity-50',
          )}
        >
          {p === 'week' ? 'Неделя' : 'Месяц'}
        </button>
      ))}
    </div>
  );
}

// ─── Widget: «Что узнали за период» ─────────────────────────────────────────

function WhatLearnedWidget({
  loading,
  newThemes,
  newSignals,
  periodLabel,
}: {
  loading: boolean;
  newThemes: DirectorDashboardThemeDomain[];
  newSignals: DirectorDashboardSignalDomain[];
  periodLabel: string;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb size={16} className="text-accent" />
          Что узнали за {periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
              Новые темы
            </h3>
            {loading && <SkeletonList />}
            {!loading && newThemes.length === 0 && (
              <EmptyHint text="Пока недостаточно данных. Появятся, как только AI-кластеризатор обработает новые блоки." />
            )}
            {!loading &&
              newThemes.length > 0 &&
              newThemes.slice(0, 10).map((t) => (
                <Link
                  key={t.id}
                  href={`/themes/${encodeURIComponent(t.id)}`}
                  className="block rounded-md p-2 text-sm hover:bg-bg-overlay"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg-primary">
                      {t.name}
                    </span>
                    {t.dynamic === 'growing' && (
                      <span aria-label="растёт" title="Растёт">
                        📈
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
                    {t.branch && (
                      <span>{THEME_BRANCH_LABELS[t.branch as ThemeBranch]}</span>
                    )}
                    <span>· {t.blocksCount} блоков</span>
                  </div>
                </Link>
              ))}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
              Новые сигналы
            </h3>
            {loading && <SkeletonList />}
            {!loading && newSignals.length === 0 && (
              <EmptyHint text="Сигналов высокой важности за период не зафиксировано." />
            )}
            {!loading &&
              newSignals.length > 0 &&
              newSignals.slice(0, 10).map((s) => {
                const linkable = s.evidenceMeetingId !== null;
                const inner = (
                  <div className="rounded-md p-2 text-sm hover:bg-bg-overlay">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {signalTypeLabel(s.signalType)}
                      </Badge>
                      <span className="truncate text-fg-primary">{s.name}</span>
                    </div>
                    {s.criticalQuestion && (
                      <p className="mt-1 line-clamp-2 text-xs text-fg-tertiary">
                        {s.criticalQuestion}
                      </p>
                    )}
                  </div>
                );
                if (!linkable) {
                  return (
                    <div key={s.id} className="opacity-90">
                      {inner}
                    </div>
                  );
                }
                return (
                  <Link
                    key={s.id}
                    href={`/meetings/${encodeURIComponent(
                      s.evidenceMeetingId!,
                    )}/result?block=${encodeURIComponent(s.id)}`}
                    className="block"
                  >
                    {inner}
                  </Link>
                );
              })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Сигналы клиентов» ─────────────────────────────────────────────

function SignalCountersWidget({
  loading,
  counters,
}: {
  loading: boolean;
  counters: DirectorDashboardSignalCountersDomain | null;
}) {
  const max = useMemo(() => {
    if (!counters) return 0;
    return SIGNAL_COUNTERS_BUCKET_ORDER.reduce(
      (acc, key) => Math.max(acc, counters[key] ?? 0),
      0,
    );
  }, [counters]);

  const total = useMemo(() => {
    if (!counters) return 0;
    return SIGNAL_COUNTERS_BUCKET_ORDER.reduce(
      (acc, key) => acc + (counters[key] ?? 0),
      0,
    );
  }, [counters]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp size={16} className="text-accent" />
          Сигналы клиентов
        </CardTitle>
        {!loading && counters && (
          <Badge variant="secondary">{total}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading && <SkeletonList />}
        {!loading && counters && total === 0 && (
          <EmptyHint text="Сигналов от клиентов за период не зафиксировано." />
        )}
        {!loading && counters && total > 0 && (
          <ul className="space-y-2">
            {SIGNAL_COUNTERS_BUCKET_ORDER.map((key) => {
              const v = counters[key] ?? 0;
              const pct = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0;
              return (
                <li key={key} className="flex items-center gap-3 text-sm">
                  <div className="w-32 shrink-0 truncate text-fg-secondary">
                    {SIGNAL_COUNTERS_BUCKET_LABELS[key]}
                  </div>
                  <div className="relative flex-1 overflow-hidden rounded-full bg-bg-overlay/60">
                    <div
                      className={cn(
                        'h-2 rounded-full',
                        SIGNAL_COUNTERS_BUCKET_COLORS[key],
                      )}
                      style={{ width: v > 0 ? `${pct}%` : '0%' }}
                    />
                  </div>
                  <div className="w-8 shrink-0 text-right text-xs tabular-nums text-fg-secondary">
                    {v}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && counters && total > 0 && (
          <p
            className="mt-3 text-xs text-fg-tertiary"
            title="Открытие подборки по типу сигнала появится в следующих версиях"
          >
            Подборка по типу сигнала — vNext.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Активные темы» ────────────────────────────────────────────────

function ActiveThemesWidget({
  loading,
  themes,
}: {
  loading: boolean;
  themes: DirectorDashboardThemeDomain[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp size={16} className="text-accent" />
          Активные темы
        </CardTitle>
        {!loading && <Badge variant="secondary">{themes.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && <SkeletonList />}
        {!loading && themes.length === 0 && (
          <EmptyHint text="Растущих тем сейчас нет." />
        )}
        {!loading &&
          themes.slice(0, 10).map((t) => (
            <Link
              key={t.id}
              href={`/themes/${encodeURIComponent(t.id)}`}
              className="block rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-fg-primary">
                  {t.name}
                </span>
                {t.dynamic === 'growing' && (
                  <span aria-label="растёт" title="Растёт">
                    📈
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
                {t.branch && (
                  <span>{THEME_BRANCH_LABELS[t.branch as ThemeBranch]}</span>
                )}
                <span>· {t.blocksCount} блоков</span>
              </div>
            </Link>
          ))}
        {!loading && themes.length > 0 && (
          <Button asChild variant="ghost" size="sm" className="w-full justify-between">
            <Link href="/themes">
              Все темы
              <ArrowRight size={14} />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Главные сущности» ─────────────────────────────────────────────

function HotEntitiesWidget({
  loading,
  entities,
}: {
  loading: boolean;
  entities: DirectorDashboardEntityDomain[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users size={16} className="text-accent" />
          Главные сущности
        </CardTitle>
        {!loading && <Badge variant="secondary">{entities.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && <SkeletonList />}
        {!loading && entities.length === 0 && (
          <EmptyHint text="Сущностей с заметным ростом упоминаний за период нет." />
        )}
        {!loading &&
          entities.slice(0, 10).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-md p-2 text-sm"
              title="Страница сущности — vNext"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-fg-primary">
                  {e.canonicalName}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {entityTypeLabel(e.type)}
                </Badge>
              </div>
              <span className="shrink-0 text-xs text-fg-tertiary">
                {e.recentMentions} упом.
              </span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Открытые вопросы» ─────────────────────────────────────────────

function OpenQuestionsWidget({
  loading,
  questions,
}: {
  loading: boolean;
  questions: DirectorDashboardOpenQuestionDomain[];
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle size={16} className="text-accent" />
          Открытые вопросы
        </CardTitle>
        {!loading && <Badge variant="secondary">{questions.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <SkeletonList />}
        {!loading && questions.length === 0 && (
          <EmptyHint text="Открытых вопросов (knowledge_gap) пока нет." />
        )}
        {!loading &&
          questions.slice(0, 10).map((q) => (
            <div
              key={q.id}
              className="rounded-md border border-border-subtle/60 p-3 text-sm"
            >
              <p className="font-medium text-fg-primary">
                {q.criticalQuestion || q.name}
              </p>
              <p className="mt-1 text-xs text-fg-tertiary">
                Зафиксировано{' '}
                {q.createdAt.toLocaleDateString('ru', {
                  day: '2-digit',
                  month: 'short',
                })}
              </p>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

// ─── Skeleton helpers ───────────────────────────────────────────────────────

function SkeletonList() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-fg-tertiary">{text}</p>;
}
