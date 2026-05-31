'use client';

/**
 * Pulse §5.1 (2026-05-30) — Daily-таб дашборда спринта.
 *
 * Источник: `GET /api/v1/cycles/:id/dashboard/daily` (SprintAnalystService.getDailyDigest).
 * SWR refresh 60s.
 *
 * Секции (сверху вниз):
 *   1. Alarm-bar (sticky) — если alarmCount ≥ 1.
 *   2. Гипотеза + AI Daily Standup нарратив.
 *   3. Задачи с цветным светофором по lastActivity.
 *   4. «Кто двигает спринт»: top-3 closer + top-3 helper.
 *
 * Дизайн §1.4: skeleton, character empty, токены chip-*, никаких text-white.
 */

import useSWR from 'swr';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronRight,
  HandHeart,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';
import { sprintsApi } from '@/api/tracker/sprints.api';
import type {
  SprintActivityColorApi,
  SprintDailyDigestApi,
  SprintDailyIssueWithActivityApi,
} from '@/domain/sprint';
import { cn } from '@/ui/shadcn/lib/utils';

export function SprintDailyPanel({
  orgId,
  cycleId,
}: {
  orgId: string;
  cycleId: string;
}) {
  const swr = useSWR<SprintDailyDigestApi>(
    orgId && cycleId
      ? ['tracker.sprint.daily', orgId, cycleId]
      : null,
    async () => sprintsApi.daily(orgId, cycleId),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  if (swr.isLoading || !swr.data) {
    return <DailySkeleton />;
  }

  const d = swr.data;

  return (
    <div className="flex flex-col gap-4">
      {d.alarmCount > 0 && <AlarmBar count={d.alarmCount} />}

      <HypothesisAndNarrative
        hypothesisText={d.hypothesisText}
        aiNarrative={d.aiNarrative}
      />

      <IssuesActivitySection issues={d.issuesWithActivity} />

      <MoversSection
        topClosers={d.topClosers}
        topHelpers={d.topHelpers}
      />
    </div>
  );
}

// ───────────────────────── Alarm-bar ──────────────────────────────────────

function AlarmBar({ count }: { count: number }) {
  return (
    <div
      role="alert"
      className={cn(
        'sticky top-0 z-10 flex items-center gap-3 rounded-xl px-4 py-3 shadow-card-soft',
        'bg-chip-danger-bg text-chip-danger-fg',
      )}
    >
      <AlertTriangle size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {count === 1
            ? '1 критическая подсказка по спринту'
            : `${count} критических подсказок по спринту`}
        </div>
        <div className="text-xs opacity-80">
          Загляните в раздел «Помощник предлагает» — есть что разрулить
          сегодня.
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Hypothesis + AI Daily Standup ──────────────────────

function HypothesisAndNarrative({
  hypothesisText,
  aiNarrative,
}: {
  hypothesisText: string | null;
  aiNarrative: string | null;
}) {
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            AI Daily Standup
          </h2>
          {hypothesisText ? (
            <div className="mt-2 rounded-md bg-bg-overlay px-3 py-2 text-xs text-fg-secondary">
              <span className="font-medium text-fg-primary">Гипотеза: </span>
              {hypothesisText}
            </div>
          ) : (
            <div className="mt-2 rounded-md border border-dashed border-border-subtle px-3 py-2 text-xs text-fg-tertiary">
              Гипотеза спринта не задана. Опишите её в первом абзаце описания
              спринта — помощник будет учитывать её каждый день.
            </div>
          )}
          {aiNarrative ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
              {aiNarrative}
            </p>
          ) : (
            <p className="mt-3 text-sm text-fg-tertiary">
              Помощник ещё думает над сегодняшним брифом — обновится через
              минуту.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── Активность задач ────────────────────────────

const ACTIVITY_COLOR_STYLE: Record<
  SprintActivityColorApi,
  { bg: string; fg: string; dot: string; label: string }
> = {
  success: {
    bg: 'bg-chip-success-bg',
    fg: 'text-chip-success-fg',
    dot: 'bg-chip-success-fg',
    label: 'Свежая',
  },
  warning: {
    bg: 'bg-chip-warning-bg',
    fg: 'text-chip-warning-fg',
    dot: 'bg-chip-warning-fg',
    label: '3–4 дня',
  },
  danger: {
    bg: 'bg-chip-danger-bg',
    fg: 'text-chip-danger-fg',
    dot: 'bg-chip-danger-fg',
    label: '5+ дней',
  },
};

function IssuesActivitySection({
  issues,
}: {
  issues: SprintDailyIssueWithActivityApi[];
}) {
  if (issues.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border-subtle bg-bg-elevated p-6 text-center shadow-card-soft">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-bg-overlay text-fg-tertiary">
          <Target size={18} />
        </div>
        <div className="mt-2 text-sm font-medium text-fg-primary">
          Активных задач в спринте пока нет
        </div>
        <p className="mt-1 text-xs text-fg-tertiary">
          Когда команда добавит задачи в спринт, они появятся здесь с
          цветным светофором по последней активности.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elevated shadow-card-soft">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
          Задачи спринта — кто двигается, кто застрял
        </h2>
        <span className="text-[11px] text-fg-tertiary">
          Светофор по последней активности
        </span>
      </header>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {issues.map((i) => {
          const style = ACTIVITY_COLOR_STYLE[i.activityColor];
          return (
            <li key={i.issueId}>
              <Link
                href={`/issues/${encodeURIComponent(i.issueId)}`}
                className={cn(
                  'group flex items-center gap-3 px-5 py-3 transition-colors',
                  'hover:bg-bg-overlay',
                )}
              >
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    style.bg,
                    style.fg,
                  )}
                  title={`Активность: ${style.label}`}
                >
                  <span
                    aria-hidden
                    className={cn('h-1.5 w-1.5 rounded-full', style.dot)}
                  />
                  {style.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">
                  {i.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                  {i.title}
                </span>
                {i.assigneeName && (
                  <span className="hidden shrink-0 text-[11px] text-fg-tertiary md:inline">
                    {i.assigneeName}
                  </span>
                )}
                <ChevronRight
                  size={14}
                  className="shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────── «Кто двигает спринт» ────────────────────────────

function MoversSection({
  topClosers,
  topHelpers,
}: {
  topClosers: SprintDailyDigestApi['topClosers'];
  topHelpers: SprintDailyDigestApi['topHelpers'];
}) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <MoversCard
        title="Кто закрывает задачи"
        icon={<Trophy size={14} />}
        rows={topClosers.map((c) => ({
          name: c.name,
          metric: `${c.closedCount} ${pluralRu(c.closedCount, ['задача', 'задачи', 'задач'])}`,
        }))}
        emptyHint="Пока никто не успел закрыть задачу — день только начался."
      />
      <MoversCard
        title="Кто помогает команде"
        icon={<HandHeart size={14} />}
        rows={topHelpers.map((h) => ({
          name: h.name,
          metric: `${h.helpfulnessScore.toFixed(1)} помощи`,
        }))}
        emptyHint="Пока нет зафиксированных эпизодов помощи в этом спринте."
      />
    </section>
  );
}

function MoversCard({
  title,
  icon,
  rows,
  emptyHint,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ name: string; metric: string }>;
  emptyHint: string;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5 shadow-card-soft">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        <span className="text-accent">{icon}</span>
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-fg-tertiary">{emptyHint}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {rows.map((r, idx) => (
            <li
              key={`${idx}-${r.name}`}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-overlay"
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-overlay text-[11px] font-semibold text-fg-secondary">
                {idx + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                {r.name}
              </span>
              <span className="shrink-0 text-[11px] font-medium text-fg-tertiary">
                {r.metric}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ──────────────────────── Skeleton ────────────────────────────────────

function DailySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      <div className="h-40 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      <div className="h-32 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
        <div className="h-32 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated" />
      </div>
    </div>
  );
}

// ──────────────────────── helpers ───────────────────────────────────

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

