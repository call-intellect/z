'use client';

import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  weeklyDigestApi,
  type WeeklyDeltaApi,
  type WeeklyForecastItemApi,
  type WeeklyKpiDeltaApi,
  type WeeklyOperationsDigestApi,
  type WeeklyTeamDynamicsRowApi,
} from '@/api/weekly-digest.api';
import {
  AreaTrend,
  BarTrend,
  CardTitle,
  CHART,
  DonutCard,
  GlassCard,
  glass,
  GRAD,
  ModernPageShell,
  StatCard,
  StatusPill,
} from '@/ui/components/dashboard/modern';
import { OperationsTabs } from '@/ui/components/dashboard/OperationsTabs';

import { WeeklyPerPersonWidget } from './WeeklyPerPersonWidget';

/**
 * SBA β-8.1 — клиентский UI «Недельной сводки операционного директора».
 *
 * Показывает дайджест `WeeklyOperationsDigest` за указанную неделю.
 * `weekStart` берётся из query-параметра `?weekStart=YYYY-MM-DD`;
 * если не задан — используем понедельник прошедшей недели (по UTC).
 *
 * Навигация по неделям — кнопки «← Прошлая» / «Следующая →» (с проверкой
 * на будущее: следующую неделю не запрашиваем).
 *
 * Встроенный режим (`embedded`, ТЗ редизайн кабинета Ф2): на экране `/week`
 * клиент живёт внутри общего `ModernPageShell` + вкладок. В этом режиме:
 *   - не рендерим собственный `ModernPageShell` / `OperationsTabs`;
 *   - `weekStart` приходит пропом, навигацию проксируем в `onWeekChange`
 *     (родитель синхронизирует неделю между всеми вкладками и query);
 *   - не рендерим `WeeklyPerPersonWidget` — он переехал во вкладку
 *     «Кто держит слово».
 */
export function WeeklyDigestClient({
  embedded = false,
  weekStart: weekStartProp,
  onWeekChange,
}: {
  embedded?: boolean;
  /** Неделя извне (только embedded). Управляет родитель `/week`. */
  weekStart?: string;
  /** Колбэк смены недели (только embedded). */
  onWeekChange?: (nextWeek: string) => void;
} = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialWeek = searchParams?.get('weekStart') ?? defaultLastMondayUtc();
  const [internalWeek, setInternalWeek] = useState(initialWeek);

  // В embedded неделя — внешняя (от `/week`); иначе — собственный state.
  const weekStart =
    embedded && weekStartProp !== undefined ? weekStartProp : internalWeek;

  const digestSwr = useSWR(
    ['weekly-digest', weekStart],
    () => weeklyDigestApi.get(weekStart),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const data = digestSwr.data ?? null;
  const loading = digestSwr.isLoading;
  const error = weeklyDigestErrorMessage(digestSwr.error);

  const goToWeek = (nextWeek: string) => {
    if (embedded) {
      onWeekChange?.(nextWeek);
      return;
    }
    setInternalWeek(nextWeek);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('weekStart', nextWeek);
    router.replace(`/dashboard/operations/weekly?${params.toString()}`);
  };

  const prevWeek = shiftDate(weekStart, -7);
  const nextWeek = shiftDate(weekStart, 7);
  const today = todayUtcDate();
  const nextWeekDisabled = nextWeek > today;

  const body = (
    <>
      {/* Week-picker — стеклянная панель навигации по неделям. */}
      <div
        style={glass()}
        className={`flex flex-wrap items-center gap-3 p-3 ${
          embedded ? 'mb-6' : 'mb-6 mt-4'
        }`}
      >
        <button
          type="button"
          onClick={() => goToWeek(prevWeek)}
          className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: CHART.dim, border: '1px solid var(--border-inset)' }}
        >
          ← Прошлая неделя
        </button>
        <div className="text-sm" style={{ color: CHART.dim }}>
          <span>Неделя с </span>
          <strong style={{ color: CHART.text }}>{formatRu(weekStart)}</strong>
          {data ? (
            <>
              <span> по </span>
              <strong style={{ color: CHART.text }}>
                {formatRu(data.weekEnd)}
              </strong>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => goToWeek(nextWeek)}
          disabled={nextWeekDisabled}
          className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
          style={{ color: CHART.dim, border: '1px solid var(--border-inset)' }}
        >
          Следующая неделя →
        </button>
      </div>

      {loading ? (
        <GlassCard>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка сводки…
          </p>
        </GlassCard>
      ) : error ? (
        <GlassCard>
          <p className="text-sm" style={{ color: CHART.amber }}>
            {error}
          </p>
        </GlassCard>
      ) : data ? (
        <DigestView data={data} />
      ) : null}

      {/* ТЗ-D Фаза 5 — недельный план-факт по людям. В embedded не рендерим:
          на `/week` он переехал во вкладку «Кто держит слово». */}
      {embedded ? null : (
        <div className="mt-6">
          <WeeklyPerPersonWidget weekStart={weekStart} />
        </div>
      )}
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <ModernPageShell
      title="Недельная сводка"
      subtitle="Обзор для операционного директора: температура команды, повторяющиеся блокеры, сигналы, цели, висящие решения."
    >
      {/* §5.1 — Общая навигация по операционному разделу. */}
      <OperationsTabs />
      {body}
    </ModernPageShell>
  );
}

function DigestView(props: { data: WeeklyOperationsDigestApi }) {
  const { data } = props;
  // Pulse Wave 2 §2.2 — default `?? []` страхует от старых ответов API.
  const kpiDeltas = data.kpiDeltas ?? [];
  const teamDynamics = data.teamDynamics ?? [];
  const forecast = data.forecast ?? [];
  // ТЗ-2 Ф3 — идеи недели и дельты по разделам (страхуем от старых ответов).
  const topIdeas = data.metrics.topIdeas ?? [];
  const sectionDeltas = data.sectionDeltas;
  return (
    <div className="space-y-6">
      {/* Ф6 — hero-тренды по неделям (исторический ряд из data.trend). */}
      <HeroTrendSection trend={data.trend ?? []} />
      {/* Pulse Wave 2 §2.2 — 4 KPI с дельтами наверху для быстрого «пульса». */}
      <KpiDeltasSection items={kpiDeltas} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TeamTemperatureCard data={data} />
        <GoalsCard data={data} />
      </div>

      <BlockersSection
        blockers={data.metrics.topBlockers}
        delta={sectionDeltas?.blockers ?? null}
      />
      <InsightsSection
        insights={data.metrics.topInsights}
        delta={sectionDeltas?.insights ?? null}
      />
      <HangingDecisionsSection decisions={data.metrics.hangingDecisions} />

      <TeamDynamicsSection items={teamDynamics} />
      <ForecastSection items={forecast} />
      <IdeasSection items={topIdeas} delta={sectionDeltas?.ideas ?? null} />

      <GlassCard>
        <CardTitle icon={<Sparkles size={16} />} grad={GRAD.blue}>
          Комментарий
        </CardTitle>
        <p className="mt-1 text-xs" style={{ color: CHART.faint }}>
          Связный текст автоматически собран по показателям выше.
        </p>
        <div
          className="prose prose-sm prose-invert mt-3 max-w-none [&>*]:my-2"
          style={{ color: CHART.text }}
        >
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {data.bodyMarkdown}
          </ReactMarkdown>
        </div>
      </GlassCard>

      <p className="text-xs" style={{ color: CHART.faint }}>
        Сгенерировано {new Date(data.createdAt).toLocaleString('ru-RU')}.
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Ф6 — Hero-тренды по неделям. Читают исторический ряд `data.trend`
 * (old→new, до 12 точек). Меньше 2 точек — стеклянная заглушка.
 * ────────────────────────────────────────────────────────────────────── */

type TrendPoint = WeeklyOperationsDigestApi['trend'][number];

function HeroTrendSection({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) {
    return (
      <GlassCard>
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.violet}>
          Тренды по неделям
        </CardTitle>
        <p className="mt-3 text-sm" style={{ color: CHART.dim }}>
          Тренд появится за несколько недель — пока недостаточно истории для
          графика.
        </p>
      </GlassCard>
    );
  }
  // Графики читают доли как проценты (0..1 → 0..100) для наглядности оси.
  const moodData = trend.map((p) => ({
    weekStart: formatRuShort(p.weekStart),
    greenShare: Math.round(p.greenShare * 100),
    redShare: Math.round(p.redShare * 100),
  }));
  const execData = trend.map((p) => ({
    weekStart: formatRuShort(p.weekStart),
    goalsCompleted: p.goalsCompleted,
    hangingDecisions: p.hangingDecisions,
  }));
  const blockersData = trend.map((p) => ({
    weekStart: formatRuShort(p.weekStart),
    blockers: p.blockers,
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <AreaTrend
          title="Настроение по неделям"
          titleIcon={<Activity size={16} />}
          titleGrad={GRAD.teal}
          data={moodData}
          xKey="weekStart"
          series={[
            { key: 'greenShare', color: CHART.mint, label: 'Зелёные' },
            { key: 'redShare', color: CHART.red, label: 'Красные' },
          ]}
          height={240}
        />
        <AreaTrend
          title="Исполнение по неделям"
          titleIcon={<Target size={16} />}
          titleGrad={GRAD.violet}
          data={execData}
          xKey="weekStart"
          series={[
            { key: 'goalsCompleted', color: CHART.mint, label: 'Закрытые цели' },
            {
              key: 'hangingDecisions',
              color: CHART.red,
              label: 'Висящие решения',
            },
          ]}
          height={240}
        />
      </div>
      <BarTrend
        title="Блокеры по неделям"
        icon={<AlertTriangle size={16} />}
        grad={GRAD.amber}
        data={blockersData}
        xKey="weekStart"
        dataKey="blockers"
        height={200}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Ф6 — Температура команды (пончик) и Цели за неделю (карточки).
 * ────────────────────────────────────────────────────────────────────── */

function TeamTemperatureCard({ data }: { data: WeeklyOperationsDigestApi }) {
  const m = data.metrics;
  const donut = [
    { name: 'Зелёные', value: Math.round(m.greenShare * 100), c: CHART.mint },
    { name: 'Жёлтые', value: Math.round(m.yellowShare * 100), c: CHART.amber },
    { name: 'Красные', value: Math.round(m.redShare * 100), c: CHART.red },
  ];
  return (
    <DonutCard
      title="Температура команды"
      icon={<Users size={16} />}
      grad={GRAD.teal}
      data={donut}
      centerValue={String(m.totalCheckIns)}
      centerLabel="чек-инов"
    />
  );
}

function GoalsCard({ data }: { data: WeeklyOperationsDigestApi }) {
  const g = data.metrics.goals;
  return (
    <GlassCard>
      <CardTitle icon={<Target size={16} />} grad={GRAD.violet}>
        Цели за неделю
      </CardTitle>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <GoalStat
          value={g.completed}
          label="Закрыто"
          delta={g.completedDelta}
          deltaGood={g.completedDelta >= 0}
          color={CHART.mint}
        />
        <GoalStat
          value={g.failed}
          label="Провалено"
          delta={g.failedDelta}
          deltaGood={g.failedDelta <= 0}
          color={CHART.red}
        />
        <GoalStat value={g.inProgress} label="В работе" color={CHART.cyan} />
      </div>
    </GlassCard>
  );
}

function GoalStat({
  value,
  label,
  delta,
  deltaGood,
  color,
}: {
  value: number;
  label: string;
  delta?: number;
  deltaGood?: boolean;
  color: string;
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: 'var(--surface-inset)' }}
    >
      <div
        className="text-2xl font-semibold leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-xs" style={{ color: CHART.dim }}>
        {label}
      </div>
      {delta !== undefined ? (
        <div
          className="mt-1 text-[11px] tabular-nums"
          style={{ color: deltaGood ? CHART.mint : CHART.amber }}
        >
          {signedRu(delta)} к прошлой
        </div>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Ф6 — Списочные секции (блокеры / сигналы / висящие решения) на стекле.
 * ────────────────────────────────────────────────────────────────────── */

type Blocker = WeeklyOperationsDigestApi['metrics']['topBlockers'][number];
type Insight = WeeklyOperationsDigestApi['metrics']['topInsights'][number];
type HangingDecision =
  WeeklyOperationsDigestApi['metrics']['hangingDecisions'][number];

function BlockersSection({
  blockers,
  delta,
}: {
  blockers: Blocker[];
  delta: WeeklyDeltaApi | null;
}) {
  if (blockers.length === 0) return null;
  return (
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.amber}>
          Повторяющиеся блокеры
        </CardTitle>
        <DeltaLabel delta={delta} />
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {blockers.map((b, i) => {
          const tone = blockerTone(b.count);
          return (
            <li key={i} className="flex items-start gap-2 rounded-md p-1.5">
              <UrgencyDot tone={tone} title={URGENCY_TITLE[tone]} />
              <span className="flex-1" style={{ color: CHART.text }}>
                {b.text}
              </span>
              <span className="text-xs" style={{ color: CHART.dim }}>
                упоминаний: {b.count}
              </span>
              <OpenLink href="/themes" />
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function InsightsSection({
  insights,
  delta,
}: {
  insights: Insight[];
  delta: WeeklyDeltaApi | null;
}) {
  if (insights.length === 0) return null;
  return (
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<Sparkles size={16} />} grad={GRAD.blue}>
          Главные сигналы
        </CardTitle>
        <DeltaLabel delta={delta} />
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {insights.map((it) => {
          const tone = insightDynamicTone(it.dynamicLabel);
          return (
            <li
              key={it.insightId}
              className="flex items-start gap-2 rounded-md p-1.5"
            >
              <UrgencyDot tone={tone} title={URGENCY_TITLE[tone]} />
              <span
                className="rounded px-2 py-0.5 text-xs"
                style={{ background: 'var(--surface-inset)', color: CHART.dim }}
              >
                {it.kind}
              </span>
              <span className="flex-1" style={{ color: CHART.text }}>
                {it.statement}
              </span>
              <span className="text-xs" style={{ color: CHART.dim }}>
                динамика: {insightDynamicLabelRu(it.dynamicLabel)}
              </span>
              <OpenLink
                href={`/insights?id=${encodeURIComponent(it.insightId)}`}
              />
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function HangingDecisionsSection({
  decisions,
}: {
  decisions: HangingDecision[];
}) {
  if (decisions.length === 0) return null;
  return (
    <GlassCard>
      <CardTitle icon={<CalendarClock size={16} />} grad={GRAD.pink}>
        Висящие решения
      </CardTitle>
      <ul className="mt-3 space-y-1 text-sm">
        {decisions.map((d) => {
          const tone = hangingTone(d.ageDays);
          return (
            <li
              key={d.decisionId}
              className="flex items-start gap-2 rounded-md p-1.5"
            >
              <UrgencyDot tone={tone} title={URGENCY_TITLE[tone]} />
              <span className="flex-1" style={{ color: CHART.text }}>
                {d.statement}
              </span>
              <span className="text-xs" style={{ color: CHART.dim }}>
                возраст: {d.ageDays} дн.
              </span>
              <OpenLink
                href={`/decisions/${encodeURIComponent(d.decisionId)}`}
              />
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function defaultLastMondayUtc(): string {
  const d = new Date();
  // 0 = воскресенье, 1 = понедельник, ..., 6 = суббота.
  const dow = d.getUTCDay();
  // Вычисляем понедельник прошедшей недели (если сегодня пн, то -7 дней).
  const offset = dow === 0 ? -13 : -(dow - 1) - 7;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  return toIso(monday);
}

function shiftDate(dateLocal: string, days: number): string {
  const d = new Date(`${dateLocal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

function todayUtcDate(): string {
  return toIso(new Date());
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatRu(dateLocal: string): string {
  // YYYY-MM-DD → DD.MM.YYYY.
  const [y, m, d] = dateLocal.split('-');
  return `${d}.${m}.${y}`;
}

/** Короткая дата для оси графика: YYYY-MM-DD → DD.MM. */
function formatRuShort(dateLocal: string): string {
  const [, m, d] = dateLocal.split('-');
  return `${d}.${m}`;
}

function signedRu(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

/**
 * Маппинг ошибки SWR в человеческое сообщение. Сохраняет спец-кейсы
 * `digest_not_found` (ещё не сгенерирован) и `forbidden_role` (нет доступа).
 */
function weeklyDigestErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.code === 'digest_not_found') {
      return 'Дайджест за выбранную неделю ещё не сгенерирован. Он появится в понедельник утром по локальному времени организации.';
    }
    if (err.code === 'forbidden_role') {
      return 'Нет доступа к недельной сводке (нужна роль coo / admin / owner).';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Не удалось загрузить недельную сводку';
}

/* ──────────────────────────────────────────────────────────────────────
 * ТЗ-C Фаза 5 R13 — светофор срочности для блоков проблем.
 * Тон считаем по локальным визуальным порогам (это UI-логика, не данные).
 * Парные токены: точка — `text-chip-{tone}-fg`; нейтраль — `text-fg-tertiary`.
 * ────────────────────────────────────────────────────────────────────── */

type UrgencyTone = 'danger' | 'warning' | 'neutral';

// Висящие решения: чем старше — тем горячее.
const HANGING_DANGER_DAYS = 14;
const HANGING_WARNING_DAYS = 7;
// Повторяющиеся блокеры: чем чаще упоминают — тем горячее.
const BLOCKER_DANGER_COUNT = 5;
const BLOCKER_WARNING_COUNT = 3;

function hangingTone(ageDays: number): UrgencyTone {
  if (ageDays >= HANGING_DANGER_DAYS) return 'danger';
  if (ageDays >= HANGING_WARNING_DAYS) return 'warning';
  return 'neutral';
}

function blockerTone(count: number): UrgencyTone {
  if (count >= BLOCKER_DANGER_COUNT) return 'danger';
  if (count >= BLOCKER_WARNING_COUNT) return 'warning';
  return 'neutral';
}

/**
 * Тон по динамике сигнала. Канон API: growing | stable | declining | spike.
 * Внимания требуют только рост (`growing`) и всплеск (`spike`); остальное —
 * нейтрально (`declining` для проблемного сигнала — это хорошо).
 */
function insightDynamicTone(dynamicLabel: string): UrgencyTone {
  if (dynamicLabel === 'spike') return 'danger';
  if (dynamicLabel === 'growing') return 'warning';
  return 'neutral';
}

/** Точка-индикатор срочности (тон из палитры CHART). */
function UrgencyDot({ tone, title }: { tone: UrgencyTone; title: string }) {
  const color =
    tone === 'danger'
      ? CHART.red
      : tone === 'warning'
      ? CHART.amber
      : CHART.faint;
  return (
    <span
      aria-hidden
      className="text-base leading-none"
      style={{ color }}
      title={title}
    >
      ●
    </span>
  );
}

const URGENCY_TITLE: Record<UrgencyTone, string> = {
  danger: 'горит',
  warning: 'ждёт',
  neutral: 'без срочности',
};

/** Компактная кнопка-ссылка «Открыть» (стеклянные токены, ведёт на маршрут). */
function OpenLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-[var(--surface-hover)]"
      style={{ color: CHART.dim, border: '1px solid var(--border-inset)' }}
    >
      Открыть
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Pulse Wave 2 §2.2 — секции «KPI с дельтами / Динамика команд / Прогноз».
 * Цвета — парные токены `chip-{role}-bg` + `chip-{role}-fg`. Без hex.
 * ────────────────────────────────────────────────────────────────────── */

// Ф6 — циклические градиент/тон/иконка для ряда StatCard главных показателей.
const KPI_GRADS = [GRAD.violet, GRAD.teal, GRAD.amber, GRAD.blue] as const;
const KPI_TONES = [CHART.violet, CHART.mint, CHART.amber, CHART.blue] as const;
const KPI_ICONS = [
  <Activity key="a" size={18} />,
  <Target key="t" size={18} />,
  <AlertTriangle key="w" size={18} />,
  <Sparkles key="s" size={18} />,
] as const;

function KpiDeltasSection({ items }: { items: WeeklyKpiDeltaApi[] }) {
  if (items.length === 0) return null;
  // Ряд StatCard главных KPI. Временных рядов в weekly-digest API нет —
  // spark не выдумываем (поле опционально, не передаём).
  return (
    <section>
      <h2
        className="mb-3 text-lg font-semibold"
        style={{ color: CHART.text }}
      >
        Главные показатели
      </h2>
      <p className="mb-3 text-xs" style={{ color: CHART.faint }}>
        Сравнение с прошлой неделей.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((k, i) => (
          <KpiStatCard key={k.label} k={k} i={i} />
        ))}
      </div>
    </section>
  );
}

function KpiStatCard({ k, i }: { k: WeeklyKpiDeltaApi; i: number }) {
  // Для висящих решений рост — это плохо, а падение хорошо. Для остальных —
  // наоборот. `up` в StatCard управляет цветом дельты (мята vs янтарь).
  const isInverse = k.label === 'Висящие решения';
  const grad = KPI_GRADS[i % KPI_GRADS.length];
  const tone = KPI_TONES[i % KPI_TONES.length];
  const icon = KPI_ICONS[i % KPI_ICONS.length];
  const unitSuffix = k.unit === '%' ? '%' : k.unit === 'pts' ? ' балл.' : ' шт';
  const value = `${k.current}${unitSuffix}`;
  if (k.delta === null) {
    // Сохраняем состояние «нет данных» (нет сравнения с прошлой неделей).
    return (
      <StatCard
        icon={icon}
        grad={grad}
        tone={tone}
        value={value}
        label={`${k.label} · нет данных`}
      />
    );
  }
  // «Хорошее» направление: для инверсных метрик — снижение, иначе — рост.
  const isGood = isInverse ? k.delta <= 0 : k.delta >= 0;
  return (
    <StatCard
      icon={icon}
      grad={grad}
      tone={tone}
      value={value}
      label={k.label}
      delta={`${signedRu(k.delta)}${k.unit === '%' ? '%' : ''}`}
      up={isGood}
    />
  );
}

function TeamDynamicsSection({
  items,
}: {
  items: WeeklyTeamDynamicsRowApi[];
}) {
  if (items.length === 0) return null;
  return (
    <GlassCard>
      <CardTitle icon={<Users size={16} />} grad={GRAD.teal}>
        Динамика команд
      </CardTitle>
      <p className="mb-3 mt-1 text-xs" style={{ color: CHART.faint }}>
        Команды, которые заметно изменились за неделю.
      </p>
      <ul className="space-y-1">
        {items.map((row) => {
          const isImproved =
            row.signal === 'sentiment_improved' ||
            row.signal === 'promises_improved';
          const toneColor = isImproved ? CHART.mint : CHART.red;
          return (
            <li
              key={`${row.departmentId}-${row.signal}`}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm"
            >
              <span aria-hidden style={{ color: toneColor }}>
                {isImproved ? '↑' : '↓'}
              </span>
              <span className="font-medium" style={{ color: CHART.text }}>
                {row.departmentName}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{
                  color: toneColor,
                  background: isImproved
                    ? 'oklch(0.85 0.15 165 / 0.14)'
                    : 'oklch(0.66 0.22 25 / 0.16)',
                }}
              >
                {teamDynamicsLabel(row.signal)}
              </span>
              <span
                className="flex-1 truncate text-xs"
                style={{ color: CHART.dim }}
              >
                {row.detail}
              </span>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function teamDynamicsLabel(
  signal: WeeklyTeamDynamicsRowApi['signal'],
): string {
  switch (signal) {
    case 'sentiment_improved':
      return 'настроение улучшилось';
    case 'sentiment_dropped':
      return 'настроение упало';
    case 'promises_improved':
      return 'обещания выправились';
    case 'promises_dropped':
      return 'обещания просели';
    default:
      return signal;
  }
}

function ForecastSection({ items }: { items: WeeklyForecastItemApi[] }) {
  // Б-6 — три состояния. Пустой прогноз ≠ «скрыть»: показываем явный
  // empty-state «Пока недостаточно данных» (прототип part-week блок 8),
  // чтобы пользователь понимал, что Коре нужно накопить историю.
  if (items.length === 0) {
    return (
      <GlassCard>
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.blue}>
          Прогноз на следующую неделю
        </CardTitle>
        <div className="mt-4 rounded-2xl p-6 text-center" style={{ background: 'var(--surface-inset)' }}>
          <p className="text-sm font-medium" style={{ color: CHART.dim }}>
            Пока недостаточно данных для прогноза
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed" style={{ color: CHART.faint }}>
            Чтобы Кора строила прогноз, нужно несколько недель истории встреч и
            обещаний. Прогноз появится, когда накопится достаточно недель.
          </p>
        </div>
      </GlassCard>
    );
  }
  return (
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.blue}>
          Прогноз на следующую неделю
        </CardTitle>
        <span className="text-xs" style={{ color: CHART.faint }}>
          линейная экстраполяция тренда
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((f) => {
          // medium — заметный тренд (уверенность средняя) → ok;
          // low — слабый/нет данных (уверенность низкая) → warning.
          const status: 'ok' | 'warning' =
            f.confidence === 'medium' ? 'ok' : 'warning';
          return (
            <li
              key={f.metric}
              className="rounded-xl p-3 text-sm"
              style={{ background: 'var(--surface-inset)' }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded px-2 py-0.5 text-[11px]"
                  style={{ background: 'var(--surface-inset)', color: CHART.dim }}
                >
                  {forecastMetricLabel(f.metric)}
                </span>
                <span
                  title="Уверенность прогноза: medium — заметный тренд (≥10), low — слабый или нет данных"
                >
                  <StatusPill status={status} />
                </span>
                <span className="text-[11px]" style={{ color: CHART.faint }}>
                  {f.confidence === 'medium'
                    ? 'уверенность средняя'
                    : 'уверенность низкая'}
                </span>
              </div>
              <p className="mt-1.5" style={{ color: CHART.text }}>
                {f.projection}
              </p>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function forecastMetricLabel(
  metric: WeeklyForecastItemApi['metric'],
): string {
  switch (metric) {
    case 'sentiment':
      return 'Настроение';
    case 'promises':
      return 'Обещания';
    case 'hanging_decisions':
      return 'Висящие решения';
    default:
      return metric;
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * ТЗ-2 Ф3 — идеи за неделю + дельты по разделам (неделя к неделе).
 * Цвета — парные/современные токены. Без hex / text-white / slate.
 * ────────────────────────────────────────────────────────────────────── */

type WeeklyIdea = NonNullable<
  WeeklyOperationsDigestApi['metrics']['topIdeas']
>[number];

function IdeasSection({
  items,
  delta,
}: {
  items: WeeklyIdea[];
  delta: WeeklyDeltaApi | null;
}) {
  if (items.length === 0) return null;
  return (
    <GlassCard>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg-primary">Идеи за неделю</h2>
        <DeltaLabel delta={delta} />
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((idea) => (
          <li
            key={idea.ideaId}
            className="flex flex-wrap items-center gap-2 rounded-md p-2"
          >
            <span className="rounded bg-bg-overlay px-2 py-0.5 text-[11px] text-fg-secondary">
              {ideaStatusLabel(idea.status)}
            </span>
            <span className="flex-1 text-fg-primary">{idea.statement}</span>
            <span className="text-xs text-fg-secondary">
              вес {idea.weight}
            </span>
            <span className="text-xs text-fg-tertiary">
              сторонников: {idea.supporterCount}
            </span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

/** ТЗ-2 Ф3 — русские лейблы статуса идеи. */
function ideaStatusLabel(status: string): string {
  switch (status) {
    case 'captured':
      return 'зафиксирована';
    case 'in_discussion':
      return 'в обсуждении';
    case 'accepted':
      return 'принята';
    case 'in_progress':
      return 'в работе';
    case 'shipped':
      return 'внедрена';
    case 'rejected':
      return 'отклонена';
    case 'archived':
      return 'в архиве';
    default:
      return status;
  }
}

/**
 * ТЗ-2 Ф3 — компактная дельта раздела «к прошлой неделе».
 * delta>0 → «↑ N» (мята), delta<0 → «↓ N» (янтарь/красный),
 * delta===0 → «без изменений», delta/blok===null → «—».
 */
function DeltaLabel({ delta }: { delta: WeeklyDeltaApi | null }) {
  if (!delta || delta.delta === null) {
    return <span className="text-xs text-fg-tertiary">—</span>;
  }
  const d = delta.delta;
  if (d === 0) {
    return <span className="text-xs text-fg-tertiary">без изменений</span>;
  }
  const tone =
    d > 0 ? CHART.mint : CHART.amber;
  const arrow = d > 0 ? '↑' : '↓';
  return (
    <span className="text-xs tabular-nums" style={{ color: tone }}>
      {arrow} {Math.abs(d)} к прошлой неделе
    </span>
  );
}

/**
 * Русификация динамики сигнала. Канон API: growing | stable | declining |
 * spike. Лейблы согласованы с фильтрами на странице `/insights`.
 */
function insightDynamicLabelRu(dynamicLabel: string): string {
  switch (dynamicLabel) {
    case 'spike':
      return 'всплеск';
    case 'growing':
      return 'растёт';
    case 'stable':
      return 'стабильно';
    case 'declining':
      return 'снижается';
    default:
      return dynamicLabel;
  }
}
