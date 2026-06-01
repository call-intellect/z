'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { dashboardApi } from '@/api/dashboard.api';
import { useAuth } from '@/contexts/auth-context';
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
import { OrgChatPanel } from '@/ui/components/chat/OrgChatPanel';
import { ActivityFeedWidget } from '@/ui/components/dashboard/ActivityFeedWidget';
import { AiNarrativeWithSources } from '@/ui/components/dashboard/AiNarrativeWithSources';
// Pulse Wave 6 — 7 виджетов паттернов на главной директора.
import { BottleneckHeatmapWidget } from '@/ui/components/dashboard/BottleneckHeatmapWidget';
import { BusFactorWidget } from '@/ui/components/dashboard/BusFactorWidget';
import { GoalVectorWidget } from '@/ui/components/dashboard/GoalVectorWidget';
import { IrreversibleDecisionsAlert } from '@/ui/components/dashboard/IrreversibleDecisionsAlert';
import { KnowledgeVelocityKpi } from '@/ui/components/dashboard/KnowledgeVelocityKpi';
import { LowRoiMeetingsWidget } from '@/ui/components/dashboard/LowRoiMeetingsWidget';
import { RecurringTopicsWidget } from '@/ui/components/dashboard/RecurringTopicsWidget';
import { SampleStoryBanner } from '@/ui/components/dashboard/SampleStoryBanner';
import { TeamHealthGrid } from '@/ui/components/dashboard/TeamHealthGrid';
import { KpiHero } from '@/ui/components/shared/KpiHero';
import { CurationPendingWidget } from './widgets/CurationPendingWidget';
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
 *   - Inline org-chat внизу (на Фазе 8 шаг 5 будет вынесен в OrgChatPanel).
 *   - Зарезервировано место для виджета «Согласованность стратегии» (Phase 9).
 */
export function DirectorDashboardClient() {
  const { user } = useAuth();
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
      setLoading(true);
      setError(null);
      try {
        const res = await dashboardApi.getDirectorView(nextPeriod);
        setData(directorDashboardFromApi(res));
      } catch (e) {
        const message =
          e instanceof ApiError ? e.message : 'Не удалось загрузить дашборд';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadPulse = useCallback(
    async (nextPeriod: DirectorDashboardPeriod) => {
      setPulseLoading(true);
      setPulseError(null);
      try {
        const res = await dashboardApi.getPulsePatterns(nextPeriod);
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
    [],
  );

  useEffect(() => {
    void load(period);
    void loadPulse(period);
  }, [period, load, loadPulse]);

  const greetingName = useMemo(() => {
    return user?.name?.trim() || user?.email?.split('@')[0] || 'друг';
  }, [user]);

  const periodLabel = period === 'week' ? 'неделю' : 'месяц';

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
      {/* §4.2 — Sticky-header страницы с backdrop-blur и тонким border. */}
      <header className="sticky top-0 z-20 -mx-4 mb-6 flex flex-col gap-3 border-b border-border-subtle/50 bg-bg-base/85 px-4 py-3 backdrop-blur-md md:-mx-6 md:flex-row md:items-center md:justify-between md:px-6">
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

      {/* §4.1 — Hero-strip KPI в карточке с градиентом и shadow-lg.
          CountUp числа отрисовываются внутри `KpiHero` — здесь оборачиваем
          сам блок без правки внешних компонентов (см. ограничение ТЗ). */}
      <StaggerSection delayMs={nextStagger()}>
        <div className="mb-6 rounded-2xl bg-gradient-to-br from-bg-card via-bg-card to-accent/5 p-4 shadow-lg md:p-5">
          {data?.isEmpty && <SampleStoryBanner />}

          {/* Pulse Wave 6 §6.8 — Алерт о необратимых решениях без альтернатив. */}
          {pulse && !pulseLoading && (
            <IrreversibleDecisionsAlert
              decisions={pulse.irreversibleDecisions.decisions}
              alertCount={pulse.irreversibleDecisions.alertCount}
            />
          )}

          {/* Pulse Wave 1 §1.5 + Wave 6 §6.7 — KPI hero strip. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiHero
              label="Индекс настроения недели"
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
              sparkline={data?.kpiCommitmentReliability?.sparkline}
              delta={data?.kpiCommitmentReliability?.delta}
              deltaLabel="за 14 дней"
              threshold={{ green: 80, yellow: 60 }}
              href="/me/commitments"
            />
            <KpiHero
              label="Висящие решения"
              value={data?.kpiHangingDecisions?.value ?? 0}
              numericValue={data?.kpiHangingDecisions?.value ?? 0}
              sparkline={data?.kpiHangingDecisions?.sparkline}
              threshold={{ green: 2, yellow: 5, inverted: true }}
              href="/decisions?status=hanging"
            />
            {/* Pulse Wave 6 §6.7 — Knowledge Velocity (median hours to answer). */}
            <KnowledgeVelocityKpi data={pulse?.knowledgeVelocity ?? null} />
          </div>
        </div>
      </StaggerSection>

      <StaggerSection delayMs={nextStagger()}>
        <div className="mb-6">
          <IntroWizardWidget />
        </div>
      </StaggerSection>

      {/* §4.4 — AI-сводка с inner-glow карточкой и микро-лейблом. */}
      {data?.narrativeSummary && (
        <StaggerSection delayMs={nextStagger()}>
          <div className="mb-6 rounded-2xl border border-accent/20 bg-bg-card p-5 shadow-lg shadow-accent/15">
            <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-widest text-accent-fg">
              <Sparkles size={12} aria-hidden />
              <span>AI-сводка</span>
            </div>
            <AiNarrativeWithSources
              data={data.narrativeSummary}
              periodLabel={periodLabel}
            />
          </div>
        </StaggerSection>
      )}

      {/* §4.3 «Решения и риски» — см. блок IrreversibleDecisionsAlert + SampleStoryBanner
          выше внутри Hero-strip (по позиции — над KPI). Здесь — категория «Команда и здоровье». */}
      <StaggerSection delayMs={nextStagger()}>
        <SectionHeader title="Команда и здоровье" />
        <div className="mb-6">
          <TeamHealthGrid />
        </div>
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Pulse Wave 6 §6.2 — Bus Factor (узкая колонка слева). */}
          <div className="lg:col-span-1">
            <BusFactorWidget
              data={pulse?.busFactor ?? null}
              loading={pulseLoading}
              error={pulseError}
            />
          </div>
          {/* Pulse Wave 1 §1.8 — ActivityFeedWidget (probe_question на главной). */}
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
      </StaggerSection>

      {/* §4.3 «Знания» — Knowledge Velocity уже в Hero-strip; здесь — RecurringTopics. */}
      <StaggerSection delayMs={nextStagger()}>
        <SectionHeader title="Знания" />
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-3">
          <div className="lg:col-span-1 xl:col-span-1">
            <RecurringTopicsWidget
              data={pulse?.recurringTopics ?? null}
              loading={pulseLoading}
              error={pulseError}
            />
          </div>
          {/* Bottleneck Heatmap — крупный, занимает 2 колонки (§4.5 mosaic). */}
          <div className="lg:col-span-2 xl:col-span-2">
            <BottleneckHeatmapWidget
              data={pulse?.bottlenecks ?? null}
              loading={pulseLoading}
              error={pulseError}
            />
          </div>
        </div>
      </StaggerSection>

      {/* §4.3 «Цели и встречи» — GoalVector + LowRoiMeetings (mosaic 2/1). */}
      <StaggerSection delayMs={nextStagger()}>
        <SectionHeader title="Цели и встречи" />
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-3">
          <div className="lg:col-span-2 xl:col-span-2">
            <GoalVectorWidget
              data={pulse?.goalVector ?? null}
              loading={pulseLoading}
              error={pulseError}
            />
          </div>
          <div className="lg:col-span-1 xl:col-span-1">
            <LowRoiMeetingsWidget
              meetings={pulse?.lowRoiMeetings.meetings ?? []}
              loading={pulseLoading}
              error={pulseError}
            />
          </div>
        </div>
      </StaggerSection>

      {/* Базовый блок виджетов knowledge-core (Фаза 8) — без рекомпозиции, заголовка нет. */}
      <StaggerSection delayMs={nextStagger()}>
        <SectionHeader title="Темы, сигналы, открытые вопросы" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <StructureSummaryWidget />
          <WhatLearnedWidget
            loading={loading}
            newThemes={data?.newThemes ?? []}
            newSignals={data?.newSignals ?? []}
            periodLabel={periodLabel}
          />
          <SignalCountersWidget
            loading={loading}
            counters={data?.signalCounters ?? null}
          />
          <ActiveThemesWidget
            loading={loading}
            themes={data?.activeThemes ?? []}
          />
          <HotEntitiesWidget
            loading={loading}
            entities={data?.hotEntities ?? []}
          />
          <OpenQuestionsWidget
            loading={loading}
            questions={data?.openQuestions ?? []}
          />
          <StrategicAlignmentWidget
            data={data?.strategicAlignment}
            loading={loading}
          />
          {/* Фаза C — карточка «Качество встреч» (только owner/admin; backend защищает 403). */}
          <QualityScoreWidget />
          {/* SBA α-4 — карточка «На проверке у меня» (Layer 4 Curation). */}
          <CurationPendingWidget />
          {/* SBA β-4 — карточка «Топ-5 повторяющихся проблем» (Insights Radar). */}
          <InsightsTopWidget />
        </div>
      </StaggerSection>

      <StaggerSection delayMs={nextStagger()}>
        <section className="mt-8">
          <header className="mb-3 flex items-center gap-2">
            <MessageCircle size={16} className="text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-fg-primary">
                Спросите про вашу компанию
              </h2>
              <p className="text-xs text-fg-tertiary">
                AI ищет ответ в архиве встреч и знаний организации, отвечает с цитатами.
              </p>
            </div>
          </header>
          <OrgChatPanel
            withHistory={false}
            height="400px"
            placeholder="Например: какие основные риски за неделю?"
            intro={
              <div className="px-4 py-8 text-center text-xs text-fg-tertiary">
                Например: «Какие основные риски за неделю?» или «О чём договорились
                с ключевыми клиентами?»
              </div>
            }
          />
        </section>
      </StaggerSection>
    </div>
  );
}

// ─── §4.3 SectionHeader — заголовок категории виджетов с тонким divider. ─────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 mt-2 flex items-center gap-3 border-t border-border-subtle/30 pt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-secondary">
        {title}
      </h2>
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
