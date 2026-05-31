'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
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
import { KpiHero } from '@/ui/components/shared/KpiHero';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../../admin/AdminStateViews';

/**
 * `/persons/:id/pulse` — Pulse-карточка сотрудника (Wave 3 §3.4 + §3.6 + §3.8).
 *
 * Данные собираются на бэке в `PersonPulseService.getPulse` за один запрос.
 * Frontend только рендерит — без дополнительных fetch'ей.
 *
 * UX-состояния (frontend-rules): loading / forbidden / not-found / error / data.
 */
export function PersonPulseClient({ personId }: { personId: string }) {
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

  return <PersonPulseContent personId={personId} orgId={currentOrgId} />;
}

// ────────────────────────── content ──────────────────────────────────────

function PersonPulseContent({
  personId,
  orgId,
}: {
  personId: string;
  orgId: string;
}) {
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
        description="Просмотр Pulse-карточки доступен руководителям организации (owner / admin / COO) или самому сотруднику."
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
      <BackLink personId={personId} />
      <HeaderBlock data={data} />
      <HrResumeSection data={data} />
      <div className="grid gap-4 md:grid-cols-2">
        <MoodTrendCard data={data} />
        <CheckInsCard data={data} />
      </div>
      <PromisesCard data={data} />
      <RiskFlagsSection data={data} />
      <PersonProbeQuestionsSection viewedUserId={data.viewedUserId} />
      <ComingSoonSection />
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

function HeaderBlock({ data }: { data: PersonPulse }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 rounded-xl bg-bg-card p-6 shadow-card-soft">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.08em] text-fg-tertiary">
          Pulse · карточка сотрудника
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-fg-primary">
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
      </div>
      <EngagementChip data={data} />
    </header>
  );
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles size={16} className="text-accent" />
          AI-резюме для HR
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
            Пока без AI-рекомендаций. Они появятся после первого недельного
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

function MoodTrendCard({ data }: { data: PersonPulse }) {
  const points = data.moodTrend30d;
  const counts = useMemo(() => countSentiments(points), [points]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Heart size={16} className="text-accent" />
          Настроение за 30 дней
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {points.length === 0 ? (
          <p className="text-sm text-fg-tertiary">
            За последние 30 дней нет чек-инов. Когда сотрудник начнёт отвечать
            на вечерние вопросы, тут появится тренд настроения.
          </p>
        ) : (
          <>
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
    <Card>
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

function PromisesCard({ data }: { data: PersonPulse }) {
  return (
    <Card>
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
    <Card>
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
            : 'Не удалось загрузить вопросы AI',
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle size={16} className="text-accent" />
            Вопросы AI этому человеку
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-tertiary">
            Этот человек ещё не зарегистрирован — вопросы AI отправляются
            только зарегистрированным пользователям.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle size={16} className="text-accent" />
          Вопросы AI этому человеку
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
            У этого человека ещё не было вопросов AI. Они появятся, когда
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
    <Card>
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
