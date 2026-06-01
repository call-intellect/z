'use client';

/**
 * Pulse §5.2 (2026-05-30) — Weekly-таб дашборда спринта.
 *
 * Источник: `GET /api/v1/cycles/:id/dashboard/weekly`. SWR refresh 5 минут.
 *
 * Секции (v3-expanded §3.8):
 *   1. Recap гипотезы + статус (подтверждается / нет / в процессе).
 *   2. AI Weekly Sprint Summary (markdown).
 *   3. Velocity + throughput trend.
 *   4. Health команды спринта (mini-grid).
 *   5. Outcome метрика недели.
 *   6. Что узнали за неделю.
 *   7. Action items для retro.
 *   8. Прогноз закрытия (ForecastSnapshot).
 *   9. Retro link.
 *
 * Дизайн §1.4: skeleton, character empty, токены chip-*.
 */

import useSWR from 'swr';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  ListTodo,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import { sprintsApi } from '@/api/tracker/sprints.api';
import type {
  SprintWeeklyDigestApi,
  SprintWeeklyTeamHealthRowApi,
} from '@/domain/sprint';
import { cn } from '@/ui/shadcn/lib/utils';

export function SprintWeeklyPanel({
  orgId,
  cycleId,
}: {
  orgId: string;
  cycleId: string;
}) {
  const swr = useSWR<SprintWeeklyDigestApi>(
    orgId && cycleId
      ? ['tracker.sprint.weekly', orgId, cycleId]
      : null,
    async () => sprintsApi.weekly(orgId, cycleId),
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false },
  );

  if (swr.isLoading || !swr.data) {
    return <WeeklySkeleton />;
  }

  const w = swr.data;

  return (
    <div className="flex flex-col gap-4">
      <HypothesisRecap
        hypothesisText={w.hypothesisText}
        confirmed={w.hypothesisConfirmed}
      />

      <AiNarrative narrative={w.aiNarrative} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <OutcomeCard outcome={w.outcomeMetric} />
        <VelocityCard velocity={w.velocity} />
        <ForecastCard forecast={w.forecast} />
      </div>

      <TeamHealthSection rows={w.teamHealth} />

      <LearningsSection learnings={w.learnings} />

      <ActionItemsSection
        items={w.actionItems}
        cycleId={w.cycleId}
      />
    </div>
  );
}

// ─────────────────────── Hypothesis recap ──────────────────────────────

function HypothesisRecap({
  hypothesisText,
  confirmed,
}: {
  hypothesisText: string | null;
  confirmed: boolean | null;
}) {
  const statusBadge =
    confirmed === true ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-chip-success-bg px-2 py-0.5 text-[11px] font-medium text-chip-success-fg">
        <CheckCircle2 size={11} />
        Подтверждается
      </span>
    ) : confirmed === false ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-chip-danger-bg px-2 py-0.5 text-[11px] font-medium text-chip-danger-fg">
        <XCircle size={11} />
        Не подтвердилась
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-chip-info-bg px-2 py-0.5 text-[11px] font-medium text-chip-info-fg">
        <HelpCircle size={11} />В процессе проверки
      </span>
    );

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
          Гипотеза недели
        </h2>
        {statusBadge}
      </div>
      {hypothesisText ? (
        <p className="mt-3 text-sm leading-relaxed text-fg-primary">
          {hypothesisText}
        </p>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-border-subtle px-3 py-3 text-xs text-fg-tertiary">
          Гипотеза спринта не задана. Опишите её в первом абзаце описания
          спринта — на этом таблоиде увидите, подтверждается ли она.
        </p>
      )}
    </section>
  );
}

// ─────────────────────── AI Weekly narrative ──────────────────────────────

function AiNarrative({ narrative }: { narrative: string | null }) {
  return (
    <section className="rounded-2xl border border-accent/20 bg-bg-card p-5 shadow-lg shadow-accent/15">
      <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-widest text-accent-fg">
        <Sparkles size={12} aria-hidden />
        <span>AI-сводка</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Итоги недели
          </h2>
          {narrative ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
              {narrative}
            </p>
          ) : (
            <p className="mt-3 text-sm text-fg-tertiary">
              Помощник не успел собрать связный обзор недели — обновится в
              ближайшее время.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────── Outcome / Velocity / Forecast ─────────────────

function OutcomeCard({
  outcome,
}: {
  outcome: SprintWeeklyDigestApi['outcomeMetric'];
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
        Outcome недели
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-fg-primary">
          {outcome.completedPercent}%
        </span>
        <span className="text-xs text-fg-tertiary">от плана</span>
      </div>
      <div className="mt-2 text-xs text-fg-tertiary">
        Закрыто {outcome.completed} из {outcome.total}
      </div>
    </div>
  );
}

function VelocityCard({
  velocity,
}: {
  velocity: SprintWeeklyDigestApi['velocity'];
}) {
  const TrendIcon =
    velocity.trend === 'up'
      ? ArrowUpRight
      : velocity.trend === 'down'
        ? ArrowDownRight
        : ArrowRight;
  const trendTone =
    velocity.trend === 'up'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : velocity.trend === 'down'
        ? 'bg-chip-danger-bg text-chip-danger-fg'
        : 'bg-chip-info-bg text-chip-info-fg';
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
        Velocity
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-fg-primary">
          {velocity.closedThisWeek}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
            trendTone,
          )}
        >
          <TrendIcon size={11} />
          {velocity.trend === 'up'
            ? 'выше'
            : velocity.trend === 'down'
              ? 'ниже'
              : 'на уровне'}
        </span>
      </div>
      <div className="mt-2 text-xs text-fg-tertiary">
        Прошлая неделя: {velocity.closedPrevWeek}
      </div>
    </div>
  );
}

function ForecastCard({
  forecast,
}: {
  forecast: SprintWeeklyDigestApi['forecast'];
}) {
  const label =
    forecast.trend === 'improving'
      ? 'Улучшается'
      : forecast.trend === 'declining'
        ? 'Снижается'
        : forecast.trend === 'stable'
          ? 'Стабильно'
          : '—';
  const tone =
    forecast.trend === 'improving'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : forecast.trend === 'declining'
        ? 'bg-chip-danger-bg text-chip-danger-fg'
        : 'bg-chip-info-bg text-chip-info-fg';
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
        Прогноз закрытия
      </div>
      {forecast.trend === null ? (
        <p className="mt-3 text-xs text-fg-tertiary">
          Прогноз появится после первой недели данных Forecaster'а.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-base font-medium text-fg-primary">
              {label}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                tone,
              )}
            >
              <TrendingUp size={11} />
              week-over-week
            </span>
          </div>
          {forecast.summary && (
            <div className="mt-2 text-xs text-fg-tertiary">
              {forecast.summary}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────── Team health mini-grid ─────────────────────────

function TeamHealthSection({
  rows,
}: {
  rows: SprintWeeklyTeamHealthRowApi[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <header className="mb-3 flex items-center gap-2">
        <Users size={14} className="text-accent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
          Здоровье команды
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.departmentId}
            className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-base px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-fg-primary">
                {r.departmentName}
              </div>
              <div className="text-[11px] text-fg-tertiary">
                {r.size} {pluralRu(r.size, ['человек', 'человека', 'человек'])}
              </div>
            </div>
            {r.belowCohort ? (
              <span className="inline-flex items-center rounded-full bg-bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-tertiary">
                мало данных
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
                данные есть
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────── Что узнали ────────────────────────────────────

function LearningsSection({
  learnings,
}: {
  learnings: SprintWeeklyDigestApi['learnings'];
}) {
  if (learnings.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border-subtle bg-bg-elevated p-5 text-center shadow-card-soft">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-bg-overlay text-fg-tertiary">
          <Lightbulb size={18} />
        </div>
        <div className="mt-2 text-sm font-medium text-fg-primary">
          Пока нет зафиксированных инсайтов
        </div>
        <p className="mt-1 text-xs text-fg-tertiary">
          Когда из встреч и обсуждений выделится новый факт или вопрос
          — он появится здесь.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <header className="mb-3 flex items-center gap-2">
        <Lightbulb size={14} className="text-accent" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
          Что мы узнали за неделю
        </h2>
      </header>
      <ul className="flex flex-col gap-2">
        {learnings.map((l) => (
          <li
            key={l.ideaBlockId}
            className="flex items-start gap-2 rounded-md bg-bg-overlay px-3 py-2"
          >
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="text-sm text-fg-primary">{l.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────── Action items + retro link ────────────────────

function ActionItemsSection({
  items,
  cycleId,
}: {
  items: string[];
  cycleId: string;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListTodo size={14} className="text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Action items для retro
          </h2>
        </div>
        <Link
          href={`/sprints/${encodeURIComponent(cycleId)}/review`}
          className="text-xs font-medium text-accent hover:underline"
        >
          Открыть retro →
        </Link>
      </header>
      {items.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Открытых подсказок помощника нет — приходите за retro со свежими
          наблюдениями команды.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((t, i) => (
            <li key={`${i}-${t.slice(0, 24)}`} className="text-sm text-fg-primary">
              · {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────── Skeleton ─────────────────────────────────────

function WeeklySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      <div className="h-40 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="h-28 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
        <div className="h-28 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
        <div className="h-28 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      </div>
      <div className="h-32 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      <div className="h-32 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
    </div>
  );
}

// ─────────────────────── helpers ──────────────────────────────────────

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
