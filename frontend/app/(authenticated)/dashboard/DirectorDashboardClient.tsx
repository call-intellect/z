'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import useSWR from 'swr';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Sparkles,
  Target,
} from 'lucide-react';

import { humanizeApiError } from '@/api/api-error';
import { dashboardApi } from '@/api/dashboard.api';
import { operationsDailyDigestApi } from '@/api/operations-daily-digest.api';
import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import { orgsApi } from '@/api/orgs.api';
import { useAuth } from '@/contexts/auth-context';
import { useSubscription } from '@/contexts/subscription-context';
import { useMemberships } from '@/hooks/useMemberships';
import {
  pulsePatternsFromApi,
  type PulsePatternsDomain,
} from '@/domain/pulse-patterns';
import {
  fromCheckinDisciplineApi,
  localDateString,
  type CheckinDisciplineDomain,
} from '@/domain/checkin-discipline';
import { fromDailyDigestApi, type DailyDigestDomain } from '@/domain/operations-daily-digest';
import {
  directorDashboardFromApi,
  signalTypeLabel,
  type DirectorDashboardDomain,
  type DirectorDashboardPeriod,
  type DirectorDashboardSignalDomain,
} from '@/domain/director-dashboard';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/ui/shadcn/lib/utils';
import { AiNarrativeWithSources } from '@/ui/components/dashboard/AiNarrativeWithSources';
import { CompassWidget } from '@/ui/components/dashboard/CompassWidget';
import { MainEmptyState } from '@/ui/components/dashboard/MainEmptyState';
import { RequiresActionTile } from '@/ui/components/dashboard/RequiresActionTile';
import {
  CardTitle as ModernCardTitle,
  CHART,
  GlassCard,
  GRAD,
  MODERN_PAGE_BG,
  glass,
} from '@/ui/components/dashboard/modern';
import { ValueStripWidget } from './widgets/ValueStripWidget';
import { VerdictBar } from './widgets/VerdictBar';

/**
 * Экран «Сегодня» (бывшая «Главная»), редизайн Ф1 cabinet-redesign-rhythms.
 *
 * Источник правды раскладки/тона — прототип
 * `plans/analysis/2026-06-13-cabinet-redesign-prototypes/_parts/part-today.html`.
 *
 * Тезис: первый экран отвечает за 30 секунд на 3 вопроса — что случилось /
 * что буксует и требует решения / куда движемся. ≤7 величин на первом экране.
 *
 * Состав (сверху вниз):
 *   1. Строка-вердикт (VerdictBar) — «молчит при норме».
 *   2. Грид: «Что было вчера» (daily-digest.shortSummary) + «Требует вас» (якорь).
 *   3. «Польза за неделю» (valueStrip, 5 stat).
 *   4. Грид: «Вектор к цели» (CompassWidget ← pulse.goalVector) + «Сводка Коры».
 *   5. «Самое острое» (радар топ-3 ← newSignals, затухание по свежести).
 *   6. «Лента дня» (свёрнуто, топ-5 ← daily-digest.eventsToday) + плашка
 *      «Вопросов Коры без ответа: N».
 *   7. «Дисциплина чек-инов сегодня» (checkin-discipline, from=to=сегодня).
 *
 * Онбординг (IncompleteSetupBanner) рендерится один раз в DashboardRouter —
 * здесь НЕ дублируем (исчезает после 6/6 сам).
 *
 * Источники данных:
 *   - `GET /dashboard/director?period` → directorDashboardFromApi (requiresAction,
 *     valueStrip, narrativeSummary, newSignals, isEmpty);
 *   - `GET /dashboard/pulse-patterns?period` → pulsePatternsFromApi (goalVector);
 *   - `GET /dashboard/operations/daily-digest?date` → fromDailyDigestApi
 *     (shortSummary, eventsToday, deliveredAt);
 *   - `GET /dashboard/operations/checkin-discipline?from=&to=` →
 *     fromCheckinDisciplineApi (totals.morningMissed/eveningMissed, enabled).
 *
 * Б-6: у каждого виджета три состояния — данные / нет данных (`—` + причина +
 * CTA) / сбой (плашка «чиним», без чисел). Дашборд молчит при норме.
 */
export function DirectorDashboardClient() {
  const { user, currentOrgId, currentOrgRole } = useAuth();
  const { memberships } = useMemberships();
  const { status: subscriptionStatus, loading: subscriptionLoading, showPaywallModal } =
    useSubscription();
  const [period, setPeriod] = useState<DirectorDashboardPeriod>('week');
  const [data, setData] = useState<DirectorDashboardDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pulse-паттерны — для блока «Вектор к цели». Ошибка не валит основной экран.
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
        setError(humanizeApiError(e, 'Не удалось загрузить дашборд'));
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
        setPulseError(humanizeApiError(e, 'Не удалось загрузить вектор движения'));
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

  // Сегодняшняя дата (МСК-приближение локальной датой; backend сам нормализует).
  const today = useMemo(() => localDateString(), []);

  // «Что было вчера» + «Лента дня» — последний дайджест (latest, чтобы не
  // упереться в «сегодня ещё не сгенерирован»). null = ещё нет ни одного.
  const digestSwr = useSWR<DailyDigestDomain | null>(
    currentOrgId ? ['today-daily-digest', currentOrgId] : null,
    async () => {
      const res = await operationsDailyDigestApi.getLatest();
      return res ? fromDailyDigestApi(res) : null;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Дисциплина чек-инов за сегодня (from=to=сегодня).
  const checkinSwr = useSWR<CheckinDisciplineDomain | null>(
    currentOrgId ? ['today-checkin-discipline', currentOrgId, today] : null,
    async () => {
      const res = await operationsDashboardApi.getCheckinDiscipline(
        currentOrgId!,
        today,
        today,
      );
      return fromCheckinDisciplineApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const greetingName = useMemo(() => {
    return user?.name?.trim() || user?.email?.split('@')[0] || 'друг';
  }, [user]);

  const periodLabel = period === 'week' ? 'неделю' : 'месяц';

  // ─── Матрица empty-state (сохраняем из прежней главной) ──────────────────
  const currentMembership = useMemo(
    () => memberships.find((m) => m.id === currentOrgId) ?? null,
    [memberships, currentOrgId],
  );
  const isOwnOrg = currentMembership ? !currentMembership.isReferenceDemo : true;
  const isOwnerOrAdmin = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const isPageEmpty =
    isOwnOrg &&
    subscriptionStatus === 'DEMO' &&
    isOwnerOrAdmin &&
    !loading &&
    !subscriptionLoading &&
    (data?.isEmpty === true || data === null);

  const referenceMembership = useMemo(
    () => memberships.find((m) => m.isReferenceDemo) ?? null,
    [memberships],
  );
  const canReturnToDemo = !!referenceMembership;
  const handleReturnToDemo = useCallback(() => {
    if (typeof window === 'undefined' || !referenceMembership) return;
    window.localStorage.setItem('z.activeOrgId', referenceMembership.id);
    window.location.href = '/dashboard';
  }, [referenceMembership]);

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

  if (isPageEmpty) {
    return (
      <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
          <MainEmptyState
            canReturnToDemo={canReturnToDemo}
            onReturnToDemo={handleReturnToDemo}
            setupProgress={setupProgress}
          />
        </div>
      </div>
    );
  }

  // ─── Вердикт: сбор данных не работает? (Б-6 сбой) ────────────────────────
  // degraded из directorView ИЛИ полный сбой загрузки (error при отсутствии data).
  const collectorDown = !!error && data === null;
  const digest = digestSwr.data ?? null;
  const checkin = checkinSwr.data ?? null;

  const requiresTotal = data?.requiresAction?.total ?? 0;
  const probeUnanswered = data?.requiresAction?.bySource.probe ?? 0;

  // Топ-3 самых острых сигнала — по свежести (createdAt нет, поэтому по порядку
  // newSignals: backend отдаёт свежие первыми) + затухание по индексу.
  const sharpSignals = (data?.newSignals ?? []).slice(0, 3);

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        {/* Header — приветствие + период + обновить + pill-ссылки. */}
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: CHART.text }}>
              Сегодня — {greetingName}
            </h1>
            <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
              Что случилось, что буксует, куда движемся — за 30 секунд.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/week"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: 'oklch(1 0 0 / 0.06)', color: CHART.dim }}
              aria-label="Открыть Неделю"
            >
              <Calendar size={14} strokeWidth={1.75} className="shrink-0" />
              <span>Неделя</span>
            </Link>
            <Link
              href="/month"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: 'oklch(1 0 0 / 0.06)', color: CHART.dim }}
              aria-label="Открыть Итоги месяца"
            >
              <Sparkles size={14} strokeWidth={1.75} className="shrink-0" />
              <span>Итоги месяца</span>
            </Link>
            <PeriodSwitch value={period} onChange={setPeriod} disabled={loading} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void load(period);
                void loadPulse(period);
                void digestSwr.mutate();
                void checkinSwr.mutate();
              }}
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

        {/* Сбой загрузки основного DTO (помимо вердикта — явная плашка). */}
        {error && data === null && (
          <div
            className="mb-6 flex items-center gap-2 rounded-xl p-3 text-sm"
            style={{ background: 'oklch(0.66 0.22 25 / 0.16)', color: CHART.red }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* ── 1. Строка-вердикт ────────────────────────────────────────── */}
        <div className="mb-6">
          <VerdictBar
            requiresCount={requiresTotal}
            down={collectorDown}
            subtitle={
              collectorDown
                ? 'Показатели ниже могут быть неполными — чиним сбор'
                : digest
                  ? `Последний отчёт за ${digest.dateLocal}`
                  : 'Сбор данных работает'
            }
          />
        </div>

        {/* ── 2. Грид: «Что было вчера» + «Требует вас» (якорь) ────────── */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          {/* Что было вчера — daily-digest.shortSummary. */}
          <YesterdayCard digest={digest} loading={digestSwr.isLoading} error={!!digestSwr.error} />

          {/* Требует вас — карточка-якорь (амбер-glow). */}
          <RequiresAnchorCard
            total={requiresTotal}
            bySource={data?.requiresAction?.bySource ?? null}
            loading={loading && data === null}
          />
        </div>

        {/* ── 3. Польза за неделю (5 кликабельных stat) ────────────────── */}
        <div className="mb-6">
          <ValueStripWidget
            data={
              data?.valueStrip ?? {
                meetingsProtocoled: 0,
                tasksExtracted: 0,
                decisionsExtracted: 0,
                questionsAnsweredByMemory: 0,
                commitmentsKept: 0,
              }
            }
          />
        </div>

        {/* ── 4. Грид: «Вектор к цели» + «Сводка Коры» (span2) ─────────── */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <CompassWidget
              data={pulse?.goalVector ?? null}
              loading={pulseLoading}
              error={pulseError}
            />
          </div>
          <div className="lg:col-span-2">
            <GlassCard glow className="h-full p-5">
              <div
                className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest"
                style={{ color: CHART.violet }}
              >
                <Sparkles size={12} aria-hidden />
                <span>Сводка Коры за {periodLabel}</span>
              </div>
              {loading && data === null ? (
                <p className="text-xs" style={{ color: CHART.faint }}>
                  Собираем сводку…
                </p>
              ) : data?.narrativeSummary ? (
                <>
                  <AiNarrativeWithSources
                    data={data.narrativeSummary}
                    periodLabel={periodLabel}
                  />
                  <Link
                    href="/week"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium transition-transform hover:translate-x-0.5"
                    style={{ color: CHART.cyan }}
                  >
                    Открыть полный разбор
                    <ArrowRight size={14} />
                  </Link>
                </>
              ) : (
                // Б-6: нет данных → причина + CTA.
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm" style={{ color: CHART.dim }}>
                    Сводка Коры появится после первой встречи или анализа знаний.
                  </p>
                  <Link
                    href="/meetings"
                    className="text-sm font-medium hover:underline"
                    style={{ color: CHART.cyan }}
                  >
                    К встречам →
                  </Link>
                </div>
              )}
            </GlassCard>
          </div>
        </div>

        {/* ── 5. Самое острое — радар топ-3 ────────────────────────────── */}
        <div className="mb-6">
          <SharpRadarCard
            signals={sharpSignals}
            loading={loading && data === null}
          />
        </div>

        {/* ── 6. Лента дня (свёрнуто) + плашка «Вопросов Коры без ответа» ─ */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <DayFeedCard digest={digest} loading={digestSwr.isLoading} error={!!digestSwr.error} />
          <ProbeUnansweredPill count={probeUnanswered} />
        </div>

        {/* ── 7. Дисциплина чек-инов сегодня ───────────────────────────── */}
        <div className="mb-2">
          <CheckinDisciplineTodayPill
            data={checkin}
            loading={checkinSwr.isLoading}
            error={!!checkinSwr.error}
          />
        </div>
      </div>
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
    <div
      className="inline-flex items-center rounded-md p-0.5 text-sm"
      style={{ background: 'oklch(1 0 0 / 0.06)' }}
    >
      {(['week', 'month'] as const).map((p) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          onClick={() => onChange(p)}
          className={cn(
            'rounded-sm px-3 py-1 transition-colors',
            disabled && 'opacity-50',
          )}
          style={
            value === p
              ? { background: GRAD.violet, color: CHART.text }
              : { color: CHART.dim }
          }
        >
          {p === 'week' ? 'Неделя' : 'Месяц'}
        </button>
      ))}
    </div>
  );
}

// ─── «Что было вчера» (daily-digest.shortSummary) ────────────────────────────

function YesterdayCard({
  digest,
  loading,
  error,
}: {
  digest: DailyDigestDomain | null;
  loading: boolean;
  error: boolean;
}) {
  return (
    <GlassCard glow className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ModernCardTitle icon={<Calendar size={16} />} grad={GRAD.violet}>
          Что было вчера
        </ModernCardTitle>
        {digest?.deliveredAt && (
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
            style={{ background: 'oklch(0.7 0.16 245 / 0.14)', color: CHART.blue }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: CHART.blue }}
            />
            доставлено в Telegram
          </span>
        )}
      </div>
      {error ? (
        <FixingNote />
      ) : loading ? (
        <p className="text-sm" style={{ color: CHART.faint }}>
          Собираем дайджест…
        </p>
      ) : digest?.shortSummary ? (
        <p
          className="text-sm leading-relaxed"
          style={{ color: CHART.dim, whiteSpace: 'pre-wrap' }}
        >
          {digest.shortSummary}
        </p>
      ) : (
        <EmptyHint
          text="Дайджест дня появится после первой встречи или чек-инов команды."
          ctaHref="/meetings"
          ctaLabel="К встречам →"
        />
      )}
    </GlassCard>
  );
}

// ─── «Требует вас» — карточка-якорь (амбер-glow) ─────────────────────────────

const REQUIRES_SOURCE_ORDER = ['conflict', 'curation', 'intake', 'probe'] as const;
const REQUIRES_SOURCE_LABEL: Record<
  (typeof REQUIRES_SOURCE_ORDER)[number],
  string
> = {
  conflict: 'конфликт',
  curation: 'карточка знания',
  intake: 'задача из встречи',
  probe: 'вопрос Коры',
};

function RequiresAnchorCard({
  total,
  bySource,
  loading,
}: {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  } | null;
  loading: boolean;
}) {
  const topItems = bySource
    ? REQUIRES_SOURCE_ORDER.filter((s) => bySource[s] > 0).slice(0, 3)
    : [];

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-[22px] p-5"
      style={{
        background:
          'linear-gradient(180deg, oklch(0.32 0.06 55 / 0.5), oklch(0.22 0.04 50 / 0.5))',
        border: '1px solid oklch(0.84 0.16 80 / 0.25)',
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
        style={{ background: 'oklch(0.84 0.16 80 / 0.4)' }}
      />
      <ModernCardTitle icon={<CheckCircle2 size={16} />} grad={GRAD.amber}>
        Требует вас
      </ModernCardTitle>

      {loading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.faint }}>
          Загружаем очередь…
        </p>
      ) : total > 0 ? (
        <>
          <div
            className="mt-4 text-[44px] font-semibold leading-none tabular-nums"
            style={{ color: CHART.amber, textShadow: '0 0 24px oklch(0.84 0.16 80 / 0.45)' }}
          >
            {total}
          </div>
          <div className="mb-3 mt-1.5 text-xs" style={{ color: CHART.faint }}>
            решений в очереди
          </div>
          {topItems.length > 0 && (
            <ul className="space-y-1.5">
              {topItems.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: 'oklch(1 0 0 / 0.08)', color: CHART.dim }}
                  >
                    {REQUIRES_SOURCE_LABEL[s]}
                  </span>
                  <span className="tabular-nums" style={{ color: CHART.text }}>
                    {bySource![s]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/actions"
            className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-transform hover:translate-y-[-1px]"
            style={{ background: 'oklch(1 0 0 / 0.08)', color: CHART.text }}
          >
            Открыть очередь
            <ArrowRight size={15} />
          </Link>
        </>
      ) : (
        // Б-6: N=0 — спокойно, без тревоги (управление-по-исключению).
        <div className="mt-4 flex flex-1 flex-col items-start justify-center gap-1.5">
          <span style={{ color: CHART.mint }}>
            <CheckCircle2 size={28} />
          </span>
          <p className="text-sm font-medium" style={{ color: CHART.text }}>
            Ничего не ждёт вашего решения
          </p>
          <p className="text-xs" style={{ color: CHART.faint }}>
            Кора сама разобрала очередь.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── «Самое острое» — радар топ-3 (затухание по свежести) ────────────────────

/** Тон сигнала по типу: риск/боль → красный, возражение/конкурент → амбер, иначе синий. */
function signalTone(signalType: string): { dot: string; chipBg: string } {
  if (
    signalType === 'churn_risk' ||
    signalType === 'risk' ||
    signalType === 'pain'
  ) {
    return { dot: CHART.red, chipBg: 'oklch(0.66 0.22 25 / 0.16)' };
  }
  if (
    signalType === 'objection' ||
    signalType === 'competitor_move' ||
    signalType === 'drift'
  ) {
    return { dot: CHART.amber, chipBg: 'oklch(0.84 0.16 80 / 0.14)' };
  }
  return { dot: CHART.blue, chipBg: 'oklch(0.7 0.16 245 / 0.14)' };
}

function SharpRadarCard({
  signals,
  loading,
}: {
  signals: DirectorDashboardSignalDomain[];
  loading: boolean;
}) {
  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ModernCardTitle icon={<AlertTriangle size={16} />} grad={GRAD.amber}>
          Самое острое — радар сигналов
        </ModernCardTitle>
        <Link
          href="/insights"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
          style={{ color: CHART.cyan }}
        >
          Открыть радар
          <ArrowRight size={13} />
        </Link>
      </div>
      {loading ? (
        <p className="text-sm" style={{ color: CHART.faint }}>
          Загружаем сигналы…
        </p>
      ) : signals.length === 0 ? (
        <EmptyHint text="Острых сигналов за период не зафиксировано — это хорошо." />
      ) : (
        <ul className="space-y-1">
          {signals.map((s, i) => {
            const tone = signalTone(s.signalType);
            // Затухание по свежести: свежие (i=0) ярче, дальше — мягче.
            const opacity = 1 - i * 0.18;
            const href = s.reasonSourceRef?.meetingId
              ? `/meetings/${encodeURIComponent(s.reasonSourceRef.meetingId)}`
              : s.reasonSourceRef?.decisionId
                ? `/decisions/${encodeURIComponent(s.reasonSourceRef.decisionId)}`
                : s.evidenceMeetingId
                  ? `/meetings/${encodeURIComponent(s.evidenceMeetingId)}`
                  : '/insights';
            return (
              <li key={s.id} style={{ opacity }}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[oklch(1_0_0_/_0.05)]"
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                    style={{ background: tone.chipBg }}
                    aria-hidden
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: tone.dot, boxShadow: `0 0 8px ${tone.dot}` }}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: CHART.text }}>
                      {s.name}
                    </div>
                    <div className="text-xs" style={{ color: CHART.faint }}>
                      {signalTypeLabel(s.signalType)}
                      {Number.isFinite(s.confidence) && s.confidence > 0
                        ? ` · уверенность ${Math.round(s.confidence * 100)}%`
                        : ''}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: tone.chipBg, color: tone.dot }}
                  >
                    {signalTypeLabel(s.signalType)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

// ─── «Лента дня» (свёрнуто, топ-5 eventsToday) ───────────────────────────────

const EVENT_KIND_LABEL: Record<string, string> = {
  meeting: 'встреча',
  decision: 'решение',
  signal: 'сигнал',
};

function DayFeedCard({
  digest,
  loading,
  error,
}: {
  digest: DailyDigestDomain | null;
  loading: boolean;
  error: boolean;
}) {
  const events = (digest?.eventsToday ?? []).slice(0, 5);
  return (
    <details className="group overflow-hidden" style={glass({ borderRadius: 22 })}>
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-2 p-5 text-sm font-medium"
        style={{ color: CHART.dim }}
      >
        <span className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl"
            style={{ background: GRAD.teal, color: CHART.text }}
          >
            <ClipboardCheck size={16} />
          </span>
          Лента дня{events.length > 0 ? ` · ${events.length}` : ''}
        </span>
        <ArrowRight
          size={16}
          className="shrink-0 transition-transform group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <div className="px-5 pb-5">
        {error ? (
          <FixingNote />
        ) : loading ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Загружаем события дня…
          </p>
        ) : events.length === 0 ? (
          <EmptyHint text="Событий за день пока нет — появятся после встреч и решений." />
        ) : (
          <ul className="space-y-1">
            {events.map((e) => (
              <li key={`${e.kind}:${e.id}`}>
                <Link
                  href={e.link || '/meetings'}
                  className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-[oklch(1_0_0_/_0.05)]"
                >
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: 'oklch(1 0 0 / 0.08)', color: CHART.faint }}
                  >
                    {EVENT_KIND_LABEL[e.kind] ?? e.kind}
                  </span>
                  <span className="truncate text-sm" style={{ color: CHART.text }}>
                    {e.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// ─── Плашка «Вопросов Коры без ответа: N» ────────────────────────────────────

function ProbeUnansweredPill({ count }: { count: number }) {
  return (
    <Link
      href="/actions"
      className="flex h-full flex-col justify-center gap-1.5 rounded-[22px] p-5 transition-transform hover:translate-y-[-1px]"
      style={{
        background:
          'linear-gradient(180deg, oklch(0.3 0.035 280 / 0.55), oklch(0.22 0.03 278 / 0.5))',
        border: '1px solid oklch(1 0 0 / 0.08)',
        backdropFilter: 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
      }}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest" style={{ color: CHART.faint }}>
        <MessageCircle size={13} aria-hidden />
        Вопросы Коры
      </div>
      <div
        className="text-[34px] font-semibold leading-none tabular-nums"
        style={{ color: count > 0 ? CHART.amber : CHART.mint }}
      >
        {count}
      </div>
      <div className="text-xs" style={{ color: CHART.dim }}>
        {count > 0 ? 'без ответа — Кора ждёт вашего слова' : 'все вопросы закрыты'}
      </div>
    </Link>
  );
}

// ─── Плашка «Дисциплина чек-инов сегодня» ────────────────────────────────────

function CheckinDisciplineTodayPill({
  data,
  loading,
  error,
}: {
  data: CheckinDisciplineDomain | null;
  loading: boolean;
  error: boolean;
}) {
  if (error) {
    return (
      <div
        className="rounded-[22px] p-4"
        style={glass({ borderRadius: 22 })}
      >
        <FixingNote />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="rounded-[22px] p-4" style={glass({ borderRadius: 22 })}>
        <p className="text-sm" style={{ color: CHART.faint }}>
          Загружаем дисциплину чек-инов…
        </p>
      </div>
    );
  }
  // Б-6: чек-ины выключены → причина + CTA.
  if (!data.enabled) {
    return (
      <div className="rounded-[22px] p-4" style={glass({ borderRadius: 22 })}>
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl"
            style={{ background: 'oklch(1 0 0 / 0.06)', color: CHART.faint }}
          >
            <ClipboardCheck size={16} />
          </span>
          <div>
            <div className="text-sm font-medium" style={{ color: CHART.dim }}>
              Дисциплина чек-инов — нет данных
            </div>
            <div className="text-xs" style={{ color: CHART.faint }}>
              Чек-ины выключены. Включите их в настройках, чтобы видеть ритм команды.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { morningMissed, eveningMissed } = data.totals;
  const allDone = morningMissed === 0 && eveningMissed === 0;

  return (
    <Link
      href="/structure"
      className="flex items-center gap-3 rounded-[22px] p-4 transition-transform hover:translate-y-[-1px]"
      style={glass({ borderRadius: 22 })}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
        style={{ background: GRAD.teal, color: CHART.text }}
        aria-hidden
      >
        <ClipboardCheck size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: CHART.text }}>
          Чек-ины сегодня
        </div>
        <div className="text-xs" style={{ color: allDone ? CHART.mint : CHART.dim }}>
          {allDone ? (
            'Все сдали — команда в ритме.'
          ) : (
            <>
              Не сдали: утром{' '}
              <span className="font-semibold tabular-nums" style={{ color: CHART.amber }}>
                {morningMissed}
              </span>{' '}
              · вечером{' '}
              <span className="font-semibold tabular-nums" style={{ color: CHART.amber }}>
                {eveningMissed}
              </span>
              {' '}— стоит мягко вернуть в ритм.
            </>
          )}
        </div>
      </div>
      <ArrowRight size={15} className="shrink-0" style={{ color: CHART.faint }} />
    </Link>
  );
}

// ─── Б-6 helpers ─────────────────────────────────────────────────────────────

function EmptyHint({
  text,
  ctaHref,
  ctaLabel,
}: {
  text: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm" style={{ color: CHART.dim }}>
        — {text}
      </p>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="text-sm font-medium hover:underline"
          style={{ color: CHART.cyan }}
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

/** Плашка «чиним» при сбое виджета — без чисел (Б-6 сбой). */
function FixingNote() {
  return (
    <div
      className="flex items-center gap-2 rounded-xl p-3 text-sm"
      style={{ background: 'oklch(0.84 0.16 80 / 0.12)', color: CHART.amber }}
    >
      <AlertTriangle size={15} className="shrink-0" />
      <span>Не удалось загрузить — чиним. Загляните чуть позже.</span>
    </div>
  );
}
