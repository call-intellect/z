'use client';

import { useState } from 'react';
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
import { CountUp } from '@/ui/components/dashboard/charts';
import {
  CHART,
  GlassCard,
  MODERN_PAGE_BG,
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
 */
export function WeeklyDigestClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialWeek = searchParams?.get('weekStart') ?? defaultLastMondayUtc();
  const [weekStart, setWeekStart] = useState(initialWeek);

  const digestSwr = useSWR(
    ['weekly-digest', weekStart],
    () => weeklyDigestApi.get(weekStart),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const data = digestSwr.data ?? null;
  const loading = digestSwr.isLoading;
  const error = weeklyDigestErrorMessage(digestSwr.error);

  const goToWeek = (nextWeek: string) => {
    setWeekStart(nextWeek);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('weekStart', nextWeek);
    router.replace(`/dashboard/operations/weekly?${params.toString()}`);
  };

  const prevWeek = shiftDate(weekStart, -7);
  const nextWeek = shiftDate(weekStart, 7);
  const today = todayUtcDate();
  const nextWeekDisabled = nextWeek > today;

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
      <div className="p-6">
      {/* §5.2 — Sticky-header. */}
      <header className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border-subtle/50 bg-bg-base/85 px-6 py-3 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Недельная сводка
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Обзор для операционного директора: температура команды,
          повторяющиеся блокеры, сигналы, цели, висящие решения.
        </p>
      </header>

      {/* §5.1 — Общая навигация по операционному разделу. */}
      <OperationsTabs />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border bg-bg-card p-3">
        <button
          type="button"
          onClick={() => goToWeek(prevWeek)}
          className="rounded border px-3 py-1 text-sm hover:bg-bg-subtle"
        >
          ← Прошлая неделя
        </button>
        <div className="text-sm">
          <span className="text-fg-secondary">Неделя с </span>
          <strong>{formatRu(weekStart)}</strong>
          {data ? (
            <>
              <span className="text-fg-secondary"> по </span>
              <strong>{formatRu(data.weekEnd)}</strong>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => goToWeek(nextWeek)}
          disabled={nextWeekDisabled}
          className="rounded border px-3 py-1 text-sm hover:bg-bg-subtle disabled:opacity-50"
        >
          Следующая неделя →
        </button>
      </div>

      {loading ? (
        <p className="rounded border bg-bg-card p-4 text-sm text-fg-secondary">
          Загрузка сводки…
        </p>
      ) : error ? (
        <p className="rounded border border-chip-warning-bg bg-chip-warning-bg p-4 text-sm text-chip-warning-fg">
          {error}
        </p>
      ) : data ? (
        <DigestView data={data} />
      ) : null}

      {/* ТЗ-D Фаза 5 — недельный план-факт по людям. Грузит данные сам,
          независимо от дайджеста (рендерится даже если дайджест 404). */}
      <div className="mt-6">
        <WeeklyPerPersonWidget weekStart={weekStart} />
      </div>
      </div>
    </div>
  );
}

function DigestView(props: { data: WeeklyOperationsDigestApi }) {
  const { data } = props;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // Pulse Wave 2 §2.2 — default `?? []` страхует от старых ответов API.
  const kpiDeltas = data.kpiDeltas ?? [];
  const teamDynamics = data.teamDynamics ?? [];
  const forecast = data.forecast ?? [];
  // ТЗ-2 Ф3 — идеи недели и дельты по разделам (страхуем от старых ответов).
  const topIdeas = data.metrics.topIdeas ?? [];
  const sectionDeltas = data.sectionDeltas;
  return (
    <div className="space-y-6">
      {/* Pulse Wave 2 §2.2 — 4 KPI с дельтами наверху для быстрого «пульса». */}
      <KpiDeltasSection items={kpiDeltas} />
      <TeamDynamicsSection items={teamDynamics} />
      <ForecastSection items={forecast} />
      <IdeasSection items={topIdeas} delta={sectionDeltas?.ideas ?? null} />

      <section className="rounded border bg-bg-card p-4">
        <h2 className="text-lg font-semibold">Температура команды</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего чек-инов: {data.metrics.totalCheckIns}. Зелёных{' '}
          {pct(data.metrics.greenShare)}, жёлтых{' '}
          {pct(data.metrics.yellowShare)}, красных{' '}
          {pct(data.metrics.redShare)}.
        </p>
      </section>

      <section className="rounded border bg-bg-card p-4">
        <h2 className="text-lg font-semibold">Цели за неделю</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Закрыто: {data.metrics.goals.completed} (
          {signedRu(data.metrics.goals.completedDelta)} к прошлой неделе).
          Провалено: {data.metrics.goals.failed} (
          {signedRu(data.metrics.goals.failedDelta)}). В работе:{' '}
          {data.metrics.goals.inProgress}.
        </p>
      </section>

      {data.metrics.topBlockers.length > 0 ? (
        <section className="rounded border bg-bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Повторяющиеся блокеры</h2>
            <DeltaLabel delta={sectionDeltas?.blockers ?? null} />
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.metrics.topBlockers.map((b, i) => {
              const tone = blockerTone(b.count);
              return (
                <li key={i} className="flex items-start gap-2">
                  <UrgencyDot tone={tone} title={URGENCY_TITLE[tone]} />
                  <span className="flex-1">{b.text}</span>
                  <span className="text-xs text-fg-secondary">
                    упоминаний: {b.count}
                  </span>
                  <OpenLink href="/themes" />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {data.metrics.topInsights.length > 0 ? (
        <section className="rounded border bg-bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Главные сигналы</h2>
            <DeltaLabel delta={sectionDeltas?.insights ?? null} />
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.metrics.topInsights.map((it) => {
              const tone = insightDynamicTone(it.dynamicLabel);
              return (
                <li key={it.insightId} className="flex items-start gap-2">
                  <UrgencyDot tone={tone} title={URGENCY_TITLE[tone]} />
                  <span className="rounded bg-bg-subtle px-2 py-0.5 text-xs text-fg-secondary">
                    {it.kind}
                  </span>
                  <span className="flex-1">{it.statement}</span>
                  <span className="text-xs text-fg-secondary">
                    динамика: {insightDynamicLabelRu(it.dynamicLabel)}
                  </span>
                  <OpenLink
                    href={`/insights?id=${encodeURIComponent(it.insightId)}`}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {data.metrics.hangingDecisions.length > 0 ? (
        <section className="rounded border bg-bg-card p-4">
          <h2 className="text-lg font-semibold">Висящие решения</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.metrics.hangingDecisions.map((d) => {
              const tone = hangingTone(d.ageDays);
              return (
                <li key={d.decisionId} className="flex items-start gap-2">
                  <UrgencyDot tone={tone} title={URGENCY_TITLE[tone]} />
                  <span className="flex-1">{d.statement}</span>
                  <span className="text-xs text-fg-secondary">
                    возраст: {d.ageDays} дн.
                  </span>
                  <OpenLink
                    href={`/decisions/${encodeURIComponent(d.decisionId)}`}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="rounded border bg-bg-card p-4">
        <h2 className="text-lg font-semibold">Комментарий</h2>
        <p className="mt-1 text-xs text-fg-secondary">
          Связный текст автоматически собран по показателям выше.
        </p>
        <div className="prose prose-sm prose-invert mt-3 max-w-none text-fg-primary [&>*]:my-2">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {data.bodyMarkdown}
          </ReactMarkdown>
        </div>
      </section>

      <p className="text-xs text-fg-tertiary">
        Сгенерировано {new Date(data.createdAt).toLocaleString('ru-RU')}
        {data.llmTaskRouteId ? ` · модель: ${data.llmTaskRouteId}` : ' · автоматически (без LLM)'}.
      </p>
    </div>
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

/** Точка-индикатор срочности (парные токены). */
function UrgencyDot({ tone, title }: { tone: UrgencyTone; title: string }) {
  const cls =
    tone === 'danger'
      ? 'text-chip-danger-fg'
      : tone === 'warning'
      ? 'text-chip-warning-fg'
      : 'text-fg-tertiary';
  return (
    <span aria-hidden className={`text-base leading-none ${cls}`} title={title}>
      ●
    </span>
  );
}

const URGENCY_TITLE: Record<UrgencyTone, string> = {
  danger: 'горит',
  warning: 'ждёт',
  neutral: 'без срочности',
};

/** Компактная кнопка-ссылка «Открыть» (парные токены, ведёт на маршрут). */
function OpenLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="rounded border border-border-subtle px-2 py-0.5 text-xs text-fg-secondary hover:bg-bg-subtle"
    >
      Открыть
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Pulse Wave 2 §2.2 — секции «KPI с дельтами / Динамика команд / Прогноз».
 * Цвета — парные токены `chip-{role}-bg` + `chip-{role}-fg`. Без hex.
 * ────────────────────────────────────────────────────────────────────── */

function KpiDeltasSection({ items }: { items: WeeklyKpiDeltaApi[] }) {
  if (items.length === 0) return null;
  // §5.3/§5.4 — Hero-strip главных KPI с CountUp и градиент-фоном.
  // Временных рядов (за 30 дней) в weekly-digest API нет — sparkline не выдумываем.
  return (
    <section className="rounded-2xl bg-gradient-to-br from-bg-card via-bg-card to-accent/5 p-4 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-backwards md:p-5">
      <h2 className="mb-3 text-lg font-semibold">Главные показатели</h2>
      <p className="mb-3 text-xs text-fg-tertiary">
        Сравнение с прошлой неделей.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((k) => (
          <KpiDeltaCard key={k.label} k={k} />
        ))}
      </div>
    </section>
  );
}

function KpiDeltaCard({ k }: { k: WeeklyKpiDeltaApi }) {
  const direction =
    k.delta === null ? 'flat' : k.delta > 0 ? 'up' : k.delta < 0 ? 'down' : 'flat';
  // Для висящих решений рост — это плохо, а падение хорошо. Для остальных —
  // наоборот. UI-цвет считаем по «направлению хорошо/плохо».
  const isInverse = k.label === 'Висящие решения';
  const isGood =
    direction === 'flat'
      ? null
      : isInverse
      ? direction === 'down'
      : direction === 'up';
  const tone =
    isGood === null
      ? 'neutral'
      : isGood
      ? 'success'
      : 'danger';
  const chipClass =
    tone === 'success'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : tone === 'danger'
      ? 'bg-chip-danger-bg text-chip-danger-fg'
      : 'bg-bg-subtle text-fg-secondary';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '·';
  const unitSuffix = k.unit === '%' ? '%' : k.unit === 'pts' ? ' балл.' : ' шт';
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-surface p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {k.label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-fg-primary">
          <CountUp to={k.current} />
          <span className="ml-0.5 text-sm font-normal text-fg-secondary">
            {unitSuffix}
          </span>
        </span>
        {k.delta !== null ? (
          <span
            className={`rounded px-2 py-0.5 text-[11px] tabular-nums ${chipClass}`}
            title={
              k.previous !== null
                ? `Прошлая неделя: ${k.previous}${unitSuffix}`
                : undefined
            }
          >
            {arrow} {signedRu(k.delta)}
            {k.unit === '%' || k.unit === 'pts' ? '' : ''}
          </span>
        ) : (
          <span className="rounded bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-tertiary">
            нет данных
          </span>
        )}
      </div>
    </div>
  );
}

function TeamDynamicsSection({
  items,
}: {
  items: WeeklyTeamDynamicsRowApi[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border bg-bg-card p-4">
      <h2 className="mb-3 text-lg font-semibold">Динамика команд</h2>
      <p className="mb-3 text-xs text-fg-tertiary">
        Команды, которые заметно изменились за неделю.
      </p>
      <ul className="space-y-1">
        {items.map((row) => {
          const isImproved =
            row.signal === 'sentiment_improved' ||
            row.signal === 'promises_improved';
          const chipClass = isImproved
            ? 'bg-chip-success-bg text-chip-success-fg'
            : 'bg-chip-danger-bg text-chip-danger-fg';
          return (
            <li
              key={`${row.departmentId}-${row.signal}`}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-bg-subtle"
            >
              <span aria-hidden className={isImproved ? 'text-chip-success-fg' : 'text-chip-danger-fg'}>
                {isImproved ? '↑' : '↓'}
              </span>
              <span className="font-medium text-fg-primary">
                {row.departmentName}
              </span>
              <span className={`rounded px-2 py-0.5 text-[11px] ${chipClass}`}>
                {teamDynamicsLabel(row.signal)}
              </span>
              <span className="flex-1 truncate text-xs text-fg-secondary">
                {row.detail}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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
  if (items.length === 0) return null;
  return (
    <section className="rounded border bg-bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Прогноз на следующую неделю</h2>
        <span className="text-xs text-fg-tertiary">
          линейная экстраполяция тренда
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((f) => {
          const chipClass =
            f.confidence === 'medium'
              ? 'bg-chip-info-bg text-chip-info-fg'
              : 'bg-bg-subtle text-fg-secondary';
          return (
            <li key={f.metric} className="rounded-md p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-secondary">
                  {forecastMetricLabel(f.metric)}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${chipClass}`}
                  title="Уверенность прогноза: medium — заметный тренд (≥10), low — слабый или нет данных"
                >
                  {f.confidence === 'medium' ? 'уверенность средняя' : 'уверенность низкая'}
                </span>
              </div>
              <p className="mt-1 text-fg-primary">{f.projection}</p>
            </li>
          );
        })}
      </ul>
    </section>
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
