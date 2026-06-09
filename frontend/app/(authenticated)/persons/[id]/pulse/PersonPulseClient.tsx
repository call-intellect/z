'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChartHorizontalBig,
  Calendar,
  HandCoins,
  Heart,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  UserRound,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { activityFeedApi } from '@/api/activity-feed.api';
import { personsApi } from '@/api/persons.api';
import { useAuth } from '@/contexts/auth-context';
import {
  feedItemFromApi,
  type FeedItemDomain,
  type FeedStatus,
} from '@/domain/activity-feed';
import type {
  PersonPulse,
  PersonPulseHrSuggestion,
  PersonPulseHrSuggestionType,
  PersonPulseMoodPoint,
  PersonPulseRiskFlag,
  PersonPulseSentiment,
} from '@/domain/person-pulse';
import {
  CountUp,
  MiniDonut,
  MiniSparkline,
} from '@/ui/components/dashboard/charts';
import { KpiHero } from '@/ui/components/shared/KpiHero';
import { PersonSubpagesNav } from '@/ui/components/persons/PersonSubpagesNav';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/persons/:id/pulse` — Pulse-карточка сотрудника (Wave 3 §3.4 + §3.6 + §3.8).
 *
 * Данные собираются на бэке в `PersonPulseService.getPulse` за один запрос.
 * Frontend только рендерит — без дополнительных fetch'ей.
 *
 * UX-состояния (frontend-rules): loading / forbidden / not-found / error / data.
 *
 * `mode` (ТЗ-E Фаза 2):
 *   - `manager` (default) — полный вид для руководителя (все секции). НЕ менять.
 *   - `self` — личный вид сотрудника на `/me/pulse`: без служебных блоков
 *     руководителя (HR-резюме, вопросы AI, сигналы 1:1, roadmap), тексты от
 *     первого лица. Backend дополнительно зануляет hrSuggestions при self.
 */
export type PersonPulseMode = 'manager' | 'self';

export function PersonPulseClient({
  personId,
  mode = 'manager',
}: {
  personId: string;
  mode?: PersonPulseMode;
}) {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  if (authLoading) return <AdminLoading rows={6} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации. Попросите владельца пригласить вас."
      />
    );
  }

  return (
    <PersonPulseContent personId={personId} orgId={currentOrgId} mode={mode} />
  );
}

// ────────────────────────── content ──────────────────────────────────────

function PersonPulseContent({
  personId,
  orgId,
  mode,
}: {
  personId: string;
  orgId: string;
  mode: PersonPulseMode;
}) {
  const isSelf = mode === 'self';
  const [data, setData] = useState<PersonPulse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);
    try {
      const dto = await personsApi.getPulse(orgId, personId);
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'forbidden') setForbidden(true);
        else if (e.code === 'person_not_found' || e.code === 'http_404') {
          setNotFound(true);
        } else {
          setError(e.message);
        }
      } else {
        setError('Не удалось загрузить карточку сотрудника');
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId, personId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }
  if (forbidden) {
    return (
      <AdminForbidden
        title="Нет доступа к карточке"
        description="Карточка Пульса доступна руководителям организации (владелец, администратор, операционный директор) и самому сотруднику. HR-партнёру — только с согласия сотрудника."
      />
    );
  }
  if (notFound) {
    return (
      <AdminForbidden
        title="Сотрудник не найден"
        description="Записи не существует или она была удалена."
      />
    );
  }
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
      {/* Навигация «назад к карточке» — служебная, только для руководителя. */}
      {!isSelf && <BackLink personId={personId} />}
      <StaggerSection delayMs={0}>
        <HeaderBlock data={data} personId={personId} isSelf={isSelf} />
      </StaggerSection>
      <PersonSubpagesNav entityId={personId} />
      {/* «Активность» = AI-резюме для HR — служебный блок руководителя. */}
      {!isSelf && (
        <StaggerSection delayMs={60}>
          <SectionHeading icon={Activity} label="Активность" />
          <HrResumeSection data={data} />
        </StaggerSection>
      )}
      <StaggerSection delayMs={120}>
        <SectionHeading
          icon={Heart}
          label={isSelf ? 'Моё здоровье и настроение' : 'Здоровье и настроение'}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <MoodTrendCard data={data} isSelf={isSelf} />
          <CheckInsCard data={data} />
        </div>
      </StaggerSection>
      <StaggerSection delayMs={180}>
        <PromisesCard data={data} isSelf={isSelf} />
      </StaggerSection>
      {/* Сигналы 1:1 и вопросы AI — служебные блоки руководителя. */}
      {!isSelf && (
        <StaggerSection delayMs={240}>
          <RiskFlagsSection data={data} />
          <PersonProbeQuestionsSection viewedUserId={data.viewedUserId} />
        </StaggerSection>
      )}
      {/* Roadmap «скоро появится» — служебный, только для руководителя. */}
      {!isSelf && (
        <StaggerSection delayMs={300}>
          <ComingSoonSection />
        </StaggerSection>
      )}
    </div>
  );
}

// ────────────────────────── stagger helper ───────────────────────────────

/**
 * StaggerSection — обёртка для enter-анимации виджетов (паттерн Фазы 4).
 * `motion-safe:` уважает `prefers-reduced-motion`, `fill-mode: backwards`
 * гарантирует один прогон без повторов.
 */
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

function SectionHeading({
  icon: Icon,
  label,
}: {
  icon: typeof Activity;
  label: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 border-t border-border-subtle/30 pt-4">
      <Icon size={14} className="text-fg-tertiary" strokeWidth={1.75} />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-secondary">
        {label}
      </h2>
    </div>
  );
}

// ────────────────────────── header ───────────────────────────────────────

function BackLink({ personId }: { personId: string }) {
  return (
    <Link
      href={`/persons/${personId}`}
      className="inline-flex items-center gap-1 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
    >
      <ArrowLeft size={14} />
      Назад к карточке
    </Link>
  );
}

function HeaderBlock({
  data,
  personId,
  isSelf,
}: {
  data: PersonPulse;
  personId: string;
  isSelf: boolean;
}) {
  const pulse = useMemo(() => computePulseScore(data), [data]);
  const initials = getInitials(data.personName);
  return (
    <>
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-br from-bg-card via-bg-card to-accent/5 p-5 shadow-lg">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent/15 text-base font-semibold uppercase tracking-wide text-accent-fg"
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-fg-tertiary">
            {isSelf ? 'Мой пульс' : 'Pulse · карточка сотрудника'}
          </p>
          <h1 className="truncate text-3xl font-semibold leading-tight text-fg-primary">
            {data.personName}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
            <span className="inline-flex items-center gap-1">
              <Mail size={13} className="text-fg-tertiary" />
              {data.email}
            </span>
            {data.departmentName && (
              <>
                <span className="text-fg-tertiary">·</span>
                <span>{data.departmentName}</span>
              </>
            )}
            {data.isHead && (
              <span className="inline-flex items-center gap-1 rounded-full bg-chip-info-bg px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-chip-info-fg">
                <ShieldCheck size={11} />
                руководитель
              </span>
            )}
          </div>
          {/* Ссылка «полный профиль» — служебная навигация руководителя. */}
          {!isSelf && (
            <Link
              href={`/persons/${personId}`}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-bg-overlay/70 px-3 py-1 text-xs font-medium text-fg-secondary transition-colors hover:bg-bg-overlay hover:text-fg-primary"
            >
              <UserRound size={13} strokeWidth={1.75} />
              Открыть полный профиль
            </Link>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pulse !== null ? (
          <PulseScoreBadge value={pulse} />
        ) : (
          <PulseScoreFallback data={data} />
        )}
        <EngagementChip data={data} />
      </div>
    </header>
    {/* Текст приватности — про видимость руководителям; в self-виде не нужен. */}
    {!isSelf && (
      <p className="mt-2 px-1 text-xs text-fg-tertiary">
        Эти данные видны руководителям организации; расширенная аналитика по
        сотрудникам без согласия — только HR-партнёрам.
      </p>
    )}
    </>
  );
}

/**
 * Pulse-score = среднее по доступным нормированным показателям 0..1:
 * - engagementScore (если есть)
 * - доля «зелёных» чек-инов в `moodTrend30d` (если есть отвеченные)
 * - promisesReliabilityPercent/100 (если хоть одно обещание учтено)
 *
 * Это сводный индикатор «всё ок / что-то не так», не строгая метрика.
 * Если ни одного сигнала нет — null, тогда показываем fallback по
 * существующим числам.
 */
function computePulseScore(data: PersonPulse): number | null {
  const parts: number[] = [];
  if (data.engagementScore !== null) parts.push(data.engagementScore);

  const moods = data.moodTrend30d.filter((p) => p.sentiment !== null);
  if (moods.length > 0) {
    const greens = moods.filter((p) => p.sentiment === 'green').length;
    const yellows = moods.filter((p) => p.sentiment === 'yellow').length;
    // green=1, yellow=0.5, red=0 — среднее по отвеченным дням.
    parts.push((greens + yellows * 0.5) / moods.length);
  }

  const totalPromises =
    data.promisesKept14d + data.promisesBroken14d + data.promisesOverdue14d;
  if (totalPromises > 0) {
    parts.push(data.promisesReliabilityPercent / 100);
  }

  if (parts.length === 0) return null;
  const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
  return Math.max(0, Math.min(1, avg));
}

function PulseScoreBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-overlay/50 px-3 py-2">
      <MiniDonut
        value={value}
        size={80}
        centerLabel={`${pct}`}
      />
      <div className="text-left">
        <div className="text-[10px] uppercase tracking-wider text-fg-tertiary">
          Pulse score
        </div>
        <div className="text-2xl font-semibold tabular-nums text-fg-primary">
          <CountUp to={pct} />
        </div>
        <div className="text-[10px] text-fg-tertiary">из 100</div>
      </div>
    </div>
  );
}

function PulseScoreFallback({ data }: { data: PersonPulse }) {
  // Совсем нет сигналов — показываем число чек-инов, как самое «живое»
  // существующее число (или 0).
  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-overlay/40 px-3 py-2">
      <Activity size={20} className="text-fg-tertiary" />
      <div className="text-left">
        <div className="text-[10px] uppercase tracking-wider text-fg-tertiary">
          Чек-инов за 30 дней
        </div>
        <div className="text-2xl font-semibold tabular-nums text-fg-primary">
          <CountUp to={data.checkInsTotal30d} />
        </div>
        <div className="text-[10px] text-fg-tertiary">
          сигналов мало для Pulse-score
        </div>
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function EngagementChip({ data }: { data: PersonPulse }) {
  if (data.engagementScore === null) {
    return (
      <div className="rounded-lg bg-bg-overlay/60 px-4 py-3 text-xs text-fg-tertiary">
        Вовлечённость пока не рассчитана.
        <br />
        Первый прогон Engagement-Scorer ночью.
      </div>
    );
  }
  const pct = Math.round(data.engagementScore * 100);
  const tone = engagementTone(data.engagementScore);
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-4 py-3',
        TONE_BG_SUBTLE[tone],
      )}
    >
      <Sparkles size={20} className={TONE_FG[tone]} />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-fg-tertiary">
          Вовлечённость
        </div>
        <div className={cn('text-2xl font-semibold tabular-nums', TONE_FG[tone])}>
          {pct}%
        </div>
        {data.engagementScoreAt && (
          <div className="text-[10px] text-fg-tertiary">
            обновлено {formatRelativeDate(data.engagementScoreAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────── HR Resume ────────────────────────────────────

function HrResumeSection({ data }: { data: PersonPulse }) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles size={16} className="text-accent" />
          Резюме Коры для HR
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.hrSuggestions && data.hrSuggestions.length > 0 ? (
          <ul className="space-y-3">
            {data.hrSuggestions.map((s, idx) => (
              <HrSuggestionItem key={`${s.type}-${idx}`} suggestion={s} />
            ))}
            {data.hrSuggestionsGeneratedAt && (
              <li className="text-[11px] text-fg-tertiary">
                Сформировано {formatRelativeDate(data.hrSuggestionsGeneratedAt)} ·
                обновляется раз в неделю
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-fg-tertiary">
            Пока без рекомендаций Коры. Они появятся после первого недельного
            прогона HR-Recommender или когда наберётся достаточно сигналов
            (встречи, чек-ины, обещания).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function HrSuggestionItem({
  suggestion,
}: {
  suggestion: PersonPulseHrSuggestion;
}) {
  const meta = HR_TYPE_META[suggestion.type];
  const Icon = meta.icon;
  return (
    <li
      className={cn(
        'rounded-lg border-l-2 bg-bg-overlay/40 p-3',
        meta.borderClass,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          size={16}
          className={cn('mt-0.5 shrink-0', meta.iconClass)}
        />
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
                meta.badgeClass,
              )}
            >
              {meta.label}
            </span>
            <span className="text-[11px] text-fg-tertiary">
              уверенность {formatConfidence(suggestion.confidence)}
            </span>
          </div>
          <p className="text-sm leading-snug text-fg-primary">{suggestion.text}</p>
          {suggestion.signals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestion.signals.map((sig, i) => (
                <span
                  key={i}
                  className="rounded-md bg-bg-overlay px-1.5 py-0.5 text-[11px] text-fg-secondary"
                >
                  {sig}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

const HR_TYPE_META: Record<
  PersonPulseHrSuggestionType,
  {
    label: string;
    icon: typeof Sparkles;
    iconClass: string;
    borderClass: string;
    badgeClass: string;
  }
> = {
  praise: {
    label: 'Похвалить',
    icon: Star,
    iconClass: 'text-chip-success-fg',
    borderClass: 'border-l-chip-success-fg/60',
    badgeClass: 'bg-chip-success-bg text-chip-success-fg',
  },
  compensation_review: {
    label: 'Ревью ЗП',
    icon: HandCoins,
    iconClass: 'text-chip-info-fg',
    borderClass: 'border-l-chip-info-fg/60',
    badgeClass: 'bg-chip-info-bg text-chip-info-fg',
  },
  workload_check: {
    label: 'Нагрузка',
    icon: TrendingUp,
    iconClass: 'text-chip-warning-fg',
    borderClass: 'border-l-chip-warning-fg/60',
    badgeClass: 'bg-chip-warning-bg text-chip-warning-fg',
  },
  development: {
    label: 'Развитие',
    icon: Sparkles,
    iconClass: 'text-accent',
    borderClass: 'border-l-accent/60',
    badgeClass: 'bg-accent-muted text-accent',
  },
  urgent_talk: {
    label: 'Поговорить срочно',
    icon: AlertTriangle,
    iconClass: 'text-chip-danger-fg',
    borderClass: 'border-l-chip-danger-fg/60',
    badgeClass: 'bg-chip-danger-bg text-chip-danger-fg',
  },
};

// ────────────────────────── Mood trend ───────────────────────────────────

function MoodTrendCard({
  data,
  isSelf,
}: {
  data: PersonPulse;
  isSelf: boolean;
}) {
  const points = data.moodTrend30d;
  const counts = useMemo(() => countSentiments(points), [points]);
  const trendSeries = useMemo(() => moodTrendSeries(points), [points]);
  const answeredCount = counts.green + counts.yellow + counts.red;
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Heart size={16} className="text-accent" />
          {isSelf ? 'Моё настроение за 30 дней' : 'Настроение за 30 дней'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {points.length === 0 || answeredCount === 0 ? (
          <MoodEmptyState />
        ) : (
          <>
            {trendSeries.length >= 2 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] uppercase tracking-wider text-fg-tertiary">
                  Тренд тона
                </span>
                <MiniSparkline
                  data={trendSeries}
                  tone={moodTrendTone(trendSeries)}
                  width={120}
                  height={24}
                />
              </div>
            )}
            <MoodSparkline points={points} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <SentimentLegend label="хорошее" tone="green" count={counts.green} />
              <SentimentLegend label="нейтральное" tone="yellow" count={counts.yellow} />
              <SentimentLegend label="плохое" tone="red" count={counts.red} />
              {counts.none > 0 && (
                <span className="text-fg-tertiary">
                  без оценки: {counts.none}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MoodEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      <BarChartHorizontalBig
        size={48}
        strokeWidth={1.2}
        className="text-fg-tertiary"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-fg-secondary">
        Недостаточно данных
      </p>
      <p className="max-w-xs text-xs text-fg-tertiary">
        Нужны ответы на вечерние чек-ины. Когда сотрудник ответит хотя бы на 3
        вопроса за период, появится тренд тона.
      </p>
    </div>
  );
}

/** Числовой ряд тона: green→1, yellow→0.5, red→0. Дни без ответа пропускаем. */
function moodTrendSeries(points: PersonPulseMoodPoint[]): number[] {
  const series: number[] = [];
  for (const p of points) {
    if (p.sentiment === 'green') series.push(1);
    else if (p.sentiment === 'yellow') series.push(0.5);
    else if (p.sentiment === 'red') series.push(0);
  }
  return series;
}

/** Тренд: первая половина vs вторая — если падает, рисуем danger/warning. */
function moodTrendTone(series: number[]): 'success' | 'warning' | 'danger' {
  if (series.length < 2) return 'success';
  const mid = Math.floor(series.length / 2);
  const left = series.slice(0, mid);
  const right = series.slice(mid);
  const avg = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
  const diff = avg(right) - avg(left);
  if (diff <= -0.25) return 'danger';
  if (diff <= -0.1) return 'warning';
  return 'success';
}

function MoodSparkline({ points }: { points: PersonPulseMoodPoint[] }) {
  // Простая столбчатая визуализация настроения, поскольку sentiment —
  // категория, а не число. Высота столбика — фиксированная, цвет — по тону.
  return (
    <div className="flex h-12 items-end gap-[3px]">
      {points.map((p, i) => (
        <div
          key={`${p.date}-${i}`}
          className={cn(
            'flex-1 rounded-sm transition-opacity',
            SENTIMENT_BAR_CLASS[sentimentKey(p.sentiment)],
          )}
          style={{
            height:
              p.sentiment === 'green'
                ? '100%'
                : p.sentiment === 'yellow'
                  ? '65%'
                  : p.sentiment === 'red'
                    ? '40%'
                    : '20%',
          }}
          title={`${p.date} — ${formatSentiment(p.sentiment)}`}
        />
      ))}
    </div>
  );
}

const SENTIMENT_BAR_CLASS: Record<'green' | 'yellow' | 'red' | 'none', string> = {
  green: 'bg-chip-success-fg/80',
  yellow: 'bg-chip-warning-fg/80',
  red: 'bg-chip-danger-fg/80',
  none: 'bg-fg-tertiary/30',
};

function SentimentLegend({
  label,
  tone,
  count,
}: {
  label: string;
  tone: 'green' | 'yellow' | 'red';
  count: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('inline-block h-2 w-2 rounded-sm', SENTIMENT_BAR_CLASS[tone])}
        aria-hidden
      />
      <span className="text-fg-secondary">
        {label}: <span className="tabular-nums">{count}</span>
      </span>
    </span>
  );
}

// ────────────────────────── Check-ins regularity ─────────────────────────

function CheckInsCard({ data }: { data: PersonPulse }) {
  const total = data.checkInsTotal30d;
  const expected = data.checkInsExpectedDays;
  const ratio = expected > 0 ? total / expected : 0;
  const tone: Tone =
    ratio >= 0.7 ? 'success' : ratio >= 0.4 ? 'warning' : 'danger';

  const qualityValues = data.moodTrend30d
    .map((p) => p.qualityScore)
    .filter((q): q is number => q !== null);
  const avgQuality =
    qualityValues.length > 0
      ? qualityValues.reduce((s, q) => s + q, 0) / qualityValues.length
      : null;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar size={16} className="text-accent" />
          Регулярность чек-инов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-4xl font-semibold tabular-nums',
                TONE_FG[tone],
              )}
            >
              {total}
            </span>
            <span className="text-sm text-fg-tertiary">
              из {expected} дней
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-overlay">
            <div
              className={cn('h-full transition-all', TONE_BAR[tone])}
              style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
            />
          </div>
        </div>
        <div className="border-t border-border-subtle pt-3">
          <div className="text-[11px] uppercase tracking-wider text-fg-tertiary">
            Качество рефлексии
          </div>
          {avgQuality === null ? (
            <p className="mt-1 text-sm text-fg-tertiary">
              Анализатор качества пока не запускался. Первый прогон —
              автоматически в течение часа после чек-инов.
            </p>
          ) : (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-fg-primary">
                {Math.round(avgQuality * 100)}%
              </span>
              <span className="text-xs text-fg-tertiary">
                среднее по {qualityValues.length}{' '}
                {pluralizeCheckIns(qualityValues.length)}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────── Promises ─────────────────────────────────────

function PromisesCard({
  data,
  isSelf,
}: {
  data: PersonPulse;
  isSelf: boolean;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle size={16} className="text-accent" />
          Надёжность обещаний (14 дней)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
          <KpiHero
            label="Reliability"
            value={`${data.promisesReliabilityPercent}%`}
            numericValue={data.promisesReliabilityPercent}
            format={(n) => `${Math.round(n)}%`}
            delta={data.promisesDelta14d}
            deltaLabel="за 14 дней"
            threshold={{ green: 80, yellow: 60 }}
            className="md:h-full"
          />
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-bg-overlay/40 p-4">
            <PromiseStat
              label="выполнено"
              value={data.promisesKept14d}
              tone="success"
            />
            <PromiseStat
              label="нарушено"
              value={data.promisesBroken14d}
              tone="danger"
            />
            <PromiseStat
              label="просрочено"
              value={data.promisesOverdue14d}
              tone="warning"
            />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-fg-tertiary">
          Учитываются обещания, адресованные этому сотруднику. Reliability =
          выполнено ÷ (выполнено + нарушено + просрочено).
        </p>
      </CardContent>
    </Card>
  );
}

function PromiseStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Tone;
}) {
  return (
    <div>
      <div className={cn('text-2xl font-semibold tabular-nums', TONE_FG[tone])}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-fg-tertiary">
        {label}
      </div>
    </div>
  );
}

// ────────────────────────── Risk flags ───────────────────────────────────

/**
 * Pulse Wave 4 §4.5 — секция активных risk-сигналов из Burnout-Risk-Detector.
 * Если флагов нет — секция не рендерится (нет шума). Если cron ещё не
 * запускался (`riskFlagsGeneratedAt === null`) — тоже не рендерим.
 *
 * Это НЕ диагноз — это повод для дружественного разговора 1:1.
 */
function RiskFlagsSection({ data }: { data: PersonPulse }) {
  if (data.riskFlags.length === 0) return null;
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle size={16} className="text-chip-warning-fg" />
          Сигналы для разговора 1:1
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {data.riskFlags.map((f, i) => (
            <RiskFlagItem key={`${f.type}-${i}`} flag={f} />
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-fg-tertiary">
          Это не диагноз. Это повод для дружественного разговора 1:1.
        </p>
      </CardContent>
    </Card>
  );
}

function RiskFlagItem({ flag }: { flag: PersonPulseRiskFlag }) {
  return (
    <li
      className={cn(
        'rounded-md border-l-2 px-3 py-2',
        RISK_SEVERITY_CLASS[flag.severity].border,
        RISK_SEVERITY_CLASS[flag.severity].bg,
      )}
    >
      <div className="text-sm font-medium text-fg-primary">
        {riskFlagLabel(flag.type)}
      </div>
      <div className="text-xs text-fg-secondary">{flag.explanation}</div>
    </li>
  );
}

const RISK_SEVERITY_CLASS: Record<
  PersonPulseRiskFlag['severity'],
  { border: string; bg: string }
> = {
  high: {
    border: 'border-l-chip-danger-fg/60',
    bg: 'bg-chip-danger-bg/30',
  },
  medium: {
    border: 'border-l-chip-warning-fg/60',
    bg: 'bg-chip-warning-bg/30',
  },
  low: {
    border: 'border-l-fg-tertiary/40',
    bg: 'bg-bg-overlay/30',
  },
};

function riskFlagLabel(type: string): string {
  switch (type) {
    case 'sentiment_dip':
      return 'Падение настроения';
    case 'reply_latency_rise':
      return 'Реже отвечает в чатах';
    case 'missed_checkins':
      return 'Пропускает чек-ины';
    case 'broken_promises':
      return 'Не выполняет обещания';
    case 'workload_overload':
      return 'Признаки перегрузки';
    case 'meeting_noshows':
      return 'Пропускает встречи';
    case 'conflict_mentions':
      return 'Упоминания конфликта';
    default:
      return type;
  }
}

// ────────────────────────── Probe-вопросы AI ────────────────────────────
//
// Секция «Вопросы AI этому человеку» — лента ActivityFeed, отфильтрованная
// по `targetUserId === viewedUserId` и `feedType='probe_question'`.
//
// До задачи A1 — был placeholder в ComingSoonSection; теперь живая секция.
// Источник API: `GET /api/v1/feed/probe_question?viewedUserId=<userId>`.
//
// Edge: `viewedUserId === null` → Person ещё не зарегистрирован, и AI ему
// вопросы не отправляет. Показываем friendly empty Card.

function PersonProbeQuestionsSection({
  viewedUserId,
}: {
  viewedUserId: string | null;
}) {
  const [items, setItems] = useState<FeedItemDomain[]>([]);
  const [loading, setLoading] = useState(viewedUserId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (viewedUserId === null) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await activityFeedApi.list({
          feedType: 'probe_question',
          viewedUserId,
          scopedToMe: false,
          limit: 10,
        });
        if (!alive) return;
        setItems(res.items.map(feedItemFromApi));
      } catch (e) {
        if (!alive) return;
        setError(
          e instanceof ApiError
            ? e.message
            : 'Не удалось загрузить вопросы Коры',
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewedUserId]);

  if (viewedUserId === null) {
    return (
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle size={16} className="text-accent" />
            Вопросы Коры этому человеку
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-tertiary">
            Этот человек ещё не зарегистрирован — вопросы Коры отправляются
            только зарегистрированным пользователям.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle size={16} className="text-accent" />
          Вопросы Коры этому человеку
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-fg-tertiary">
            У этого человека ещё не было вопросов Коры. Они появятся, когда
            помощник захочет уточнить что-то у этого сотрудника.
          </p>
        ) : (
          <ul
            className={cn(
              'space-y-2',
              items.length > 5 && 'max-h-96 overflow-y-auto pr-1',
            )}
          >
            {items.map((it) => (
              <ProbeQuestionItem key={it.id} item={it} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProbeQuestionItem({ item }: { item: FeedItemDomain }) {
  const meta = PROBE_STATUS_META[item.status];
  return (
    <li className="rounded-xl border border-border-subtle bg-bg-overlay/40 p-3 shadow-card-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium leading-snug text-fg-primary">
            {item.title}
          </div>
          {item.summary && (
            <p className="line-clamp-2 text-xs text-fg-secondary">
              {item.summary}
            </p>
          )}
          <div className="text-[11px] text-fg-tertiary">
            {formatDateRu(item.emittedAt)}
          </div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
            meta.className,
          )}
        >
          {meta.label}
        </span>
      </div>
    </li>
  );
}

const PROBE_STATUS_META: Record<FeedStatus, { label: string; className: string }> = {
  emitted: {
    label: 'активный',
    className: 'bg-chip-info-bg text-chip-info-fg',
  },
  delivered: {
    label: 'активный',
    className: 'bg-chip-info-bg text-chip-info-fg',
  },
  seen: {
    label: 'активный',
    className: 'bg-chip-info-bg text-chip-info-fg',
  },
  responded: {
    label: 'отвечен',
    className: 'bg-chip-success-bg text-chip-success-fg',
  },
  actioned: {
    label: 'отвечен',
    className: 'bg-chip-success-bg text-chip-success-fg',
  },
  dismissed: {
    label: 'скрыт',
    className: 'bg-bg-overlay text-fg-tertiary',
  },
  expired: {
    label: 'истёк',
    className: 'bg-bg-overlay text-fg-tertiary',
  },
};

function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ru-RU');
}

// ────────────────────────── Coming soon ──────────────────────────────────

function ComingSoonSection() {
  const items: Array<{ title: string; hint: string }> = [
    { title: 'Цели команды', hint: 'Доля голов, в которых задействован сотрудник' },
    { title: 'Активность в трекере', hint: 'Закрытые задачи, темп, переоценки' },
    { title: 'Граф связей', hint: 'С кем чаще всего общается на встречах' },
    { title: 'Темы знаний', hint: 'Чем человек экспертно владеет' },
  ];
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-fg-secondary">
          <TrendingDown size={16} />
          Скоро появится
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {items.map((it) => (
            <li
              key={it.title}
              className="rounded-lg border border-dashed border-border-subtle bg-bg-overlay/30 p-3"
            >
              <div className="text-sm font-medium text-fg-secondary">
                {it.title}
              </div>
              <div className="text-xs text-fg-tertiary">{it.hint}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ────────────────────────── helpers ──────────────────────────────────────

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const TONE_FG: Record<Tone, string> = {
  success: 'text-chip-success-fg',
  warning: 'text-chip-warning-fg',
  danger: 'text-chip-danger-fg',
  neutral: 'text-fg-primary',
};

const TONE_BG_SUBTLE: Record<Tone, string> = {
  success: 'bg-chip-success-bg',
  warning: 'bg-chip-warning-bg',
  danger: 'bg-chip-danger-bg',
  neutral: 'bg-bg-overlay/60',
};

const TONE_BAR: Record<Tone, string> = {
  success: 'bg-chip-success-fg/80',
  warning: 'bg-chip-warning-fg/80',
  danger: 'bg-chip-danger-fg/80',
  neutral: 'bg-accent/60',
};

function engagementTone(score: number): Tone {
  if (score >= 0.7) return 'success';
  if (score >= 0.4) return 'warning';
  return 'danger';
}

function sentimentKey(
  s: PersonPulseSentiment | null,
): 'green' | 'yellow' | 'red' | 'none' {
  if (s === 'green' || s === 'yellow' || s === 'red') return s;
  return 'none';
}

function countSentiments(points: PersonPulseMoodPoint[]): {
  green: number;
  yellow: number;
  red: number;
  none: number;
} {
  const counts = { green: 0, yellow: 0, red: 0, none: 0 };
  for (const p of points) {
    counts[sentimentKey(p.sentiment)] += 1;
  }
  return counts;
}

function formatSentiment(s: PersonPulseSentiment | null): string {
  if (s === 'green') return 'хорошее настроение';
  if (s === 'yellow') return 'нейтральное';
  if (s === 'red') return 'плохое';
  return 'без оценки';
}

function formatConfidence(c: number): string {
  if (c <= 0) return '—';
  return `${Math.round(c * 100)}%`;
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));
  if (diffDays <= 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} ${pluralizeDays(diffDays)} назад`;
  return date.toLocaleDateString('ru-RU');
}

function pluralizeDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

function pluralizeCheckIns(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'чек-ину';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'чек-инам';
  return 'чек-инам';
}
