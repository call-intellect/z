'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Crown,
  Hash,
  Loader2,
  RefreshCcw,
  Target,
  Users,
} from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { dashboardApi } from '@/api/dashboard.api';
import { useAuth } from '@/contexts/auth-context';
import {
  teamDetailFromApi,
  type TeamDetailDomain,
  type TeamDetailMemberDomain,
  type TeamDetailThemeDomain,
  type TeamMemberSentimentApi,
} from '@/domain/team-detail';
import { ActivityFeedWidget } from '@/ui/components/dashboard/ActivityFeedWidget';
import { KpiHero } from '@/ui/components/shared/KpiHero';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * /teams/[id] — детальная страница команды (Pulse Wave 2 §2.5).
 *
 * Источник: `GET /api/v1/dashboard/teams/:id` (TeamDetailService).
 *
 * Секции:
 *   1. Header — название, миссия, руководитель, размер.
 *   2. Два KPI-hero (sentiment 7d + trend, commitment 14d + delta).
 *   3. Состав команды — список Person с per-person sentiment-чипом.
 *   4. Цели команды — v1 пусто (TODO Wave 6.5 Promise Network).
 *   5. Топ-темы — links на `/themes/[id]`.
 *   6. ActivityFeedWidget(probe_question, scope='team') — внизу.
 *
 * Цвета — только парные семантические токены (`bg-chip-*` + `text-chip-*-fg`),
 * никаких жёстких hex / slate-классов (см. `feedback_paired_color_tokens.md`).
 */

const SENTIMENT_CHIP_LABEL: Record<Exclude<TeamMemberSentimentApi, null>, string> = {
  green: 'хорошо',
  yellow: 'смешанно',
  red: 'тяжело',
};

const SENTIMENT_CHIP_CLASS: Record<
  Exclude<TeamMemberSentimentApi, null>,
  string
> = {
  green: 'bg-chip-success-bg text-chip-success-fg',
  yellow: 'bg-chip-warning-bg text-chip-warning-fg',
  red: 'bg-chip-danger-bg text-chip-danger-fg',
};

export function TeamDetailClient({ departmentId }: { departmentId: string }) {
  const { currentOrgId } = useAuth();
  const [data, setData] = useState<TeamDetailDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!currentOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.getTeamDetail(currentOrgId, departmentId);
      setData(teamDetailFromApi(res));
    } catch (e) {
      if (e instanceof ApiError) {
        setError({ code: e.code, message: humanizeApiError(e) });
      } else {
        setError({
          code: 'unknown',
          message: 'Не удалось загрузить команду',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [departmentId, currentOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="mb-6 h-24 w-full" />
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6">
        <Link
          href="/teams"
          className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-accent"
        >
          <ArrowLeft size={14} />
          К списку команд
        </Link>
        <div className="mt-6 rounded-xl bg-chip-danger-bg p-6 text-chip-danger-fg shadow-card-soft">
          <p className="text-base font-medium">
            {error.code === 'department_not_found'
              ? 'Команда не найдена'
              : error.message}
          </p>
          <p className="mt-2 text-sm opacity-80">
            {error.code === 'department_not_found'
              ? 'Возможно, отдел был удалён или у вас нет к нему доступа.'
              : 'Попробуйте обновить страницу.'}
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
      {/* Top nav back */}
      <Link
        href="/teams"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-accent"
      >
        <ArrowLeft size={14} />К списку команд
      </Link>

      {/* Header */}
      <header className="mb-8 rounded-2xl bg-bg-card p-6 shadow-card-soft md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg-primary md:text-3xl">
              <Users size={24} className="text-accent" />
              {data.departmentName}
            </h1>
            {data.missionStatement && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-secondary md:text-base">
                {data.missionStatement}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-fg-tertiary">
              <span className="inline-flex items-center gap-1 rounded-full bg-bg-overlay px-2.5 py-1">
                <Users size={12} />
                {data.totalMembers}{' '}
                {pluralizePeople(data.totalMembers)}
              </span>
              {data.headPersonName && data.headPersonId && (
                <Link
                  href={`/persons/${encodeURIComponent(data.headPersonId)}`}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-overlay px-2.5 py-1 hover:text-accent"
                >
                  <Crown size={12} />
                  Руководитель: {data.headPersonName}
                </Link>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
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

      {/* KPI hero */}
      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <KpiHero
          label="Настроение команды · 7 дней"
          value={formatSigned(data.sentimentIndex)}
          numericValue={data.sentimentIndex}
          format={(n) => formatSigned(Math.round(n))}
          trend={data.sentimentTrend}
          threshold={{ green: 30, yellow: 0 }}
        />
        <KpiHero
          label="Надёжность обещаний · 14 дней"
          value={`${data.commitmentReliabilityPercent}%`}
          numericValue={data.commitmentReliabilityPercent}
          format={(n) => `${Math.round(n)}%`}
          delta={data.commitmentDelta14d}
          deltaLabel="за 14 дней"
          threshold={{ green: 80, yellow: 60 }}
        />
      </section>

      {/* Состав */}
      <section className="mb-8">
        <SectionTitle icon={<Users size={16} />}>
          Состав команды ({data.members.length})
        </SectionTitle>
        {data.members.length === 0 ? (
          <EmptyState text="В команде ещё нет сотрудников." />
        ) : (
          <div className="overflow-hidden rounded-xl bg-bg-card shadow-card-soft">
            <ul className="divide-y divide-border-subtle">
              {data.members.map((m) => (
                <MemberRow key={m.personId} member={m} />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Цели */}
      <section className="mb-8">
        <SectionTitle icon={<Target size={16} />}>
          Цели команды ({data.goals.length})
        </SectionTitle>
        {data.goals.length === 0 ? (
          <EmptyState text="Привязка целей к команде появится в Wave 6.5 (Promise Network). Пока цели связаны с автором, не с отделом." />
        ) : (
          <div className="overflow-hidden rounded-xl bg-bg-card shadow-card-soft">
            <ul className="divide-y divide-border-subtle">
              {data.goals.map((g) => (
                <li
                  key={g.goalId}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-bg-overlay/40"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/goals/${encodeURIComponent(g.goalId)}`}
                      className="block text-sm font-medium text-fg-primary hover:text-accent"
                    >
                      {g.name}
                    </Link>
                    {g.ownerPersonName && (
                      <p className="mt-1 text-xs text-fg-tertiary">
                        Владелец: {g.ownerPersonName}
                      </p>
                    )}
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-bg-overlay px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-fg-secondary">
                    {g.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Темы */}
      <section className="mb-8">
        <SectionTitle icon={<Hash size={16} />}>
          О чём команда говорит ({data.topThemes.length})
        </SectionTitle>
        {data.topThemes.length === 0 ? (
          <EmptyState text="За последние 30 дней нет тем, привязанных к участникам команды." />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.topThemes.map((t) => (
              <ThemeChip key={t.themeId} theme={t} />
            ))}
          </ul>
        )}
      </section>

      {/* Вопросы AI команде */}
      <section className="mb-2">
        <ActivityFeedWidget
          feedTypes={['probe_question']}
          scope="team"
          scopeId={departmentId}
          pageSize={10}
          title="Вопросы Коры команде"
          drillDownHref={`/me/notifications?team=${encodeURIComponent(departmentId)}`}
          emptyHint="Пока нет открытых вопросов команде."
        />
      </section>
    </div>
  );
}

// ───────────────────────── parts ─────────────────────────

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-fg-primary">
      <span className="text-accent">{icon}</span>
      {children}
    </h2>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-bg-card p-6 text-sm text-fg-tertiary shadow-card-soft">
      {text}
    </div>
  );
}

function MemberRow({ member }: { member: TeamDetailMemberDomain }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg-overlay/40">
      <Link
        href={`/persons/${encodeURIComponent(member.personId)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Avatar name={member.personName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-fg-primary">
              {member.personName}
            </p>
            {member.isHead && (
              <span className="inline-flex items-center gap-1 rounded-full bg-bg-overlay px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-secondary">
                <Crown size={10} />
                руководитель
              </span>
            )}
          </div>
          <p className="truncate text-xs text-fg-tertiary">{member.email}</p>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <SentimentChip
          sentiment={member.sentiment}
          count={member.sentimentCheckInsCount}
        />
        <ArrowRight size={14} className="text-fg-tertiary" />
      </div>
    </li>
  );
}

function SentimentChip({
  sentiment,
  count,
}: {
  sentiment: TeamMemberSentimentApi;
  count: number;
}) {
  if (!sentiment) {
    return (
      <span className="inline-flex items-center rounded-full bg-bg-overlay px-2.5 py-1 text-[11px] text-fg-tertiary">
        нет данных
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium',
        SENTIMENT_CHIP_CLASS[sentiment],
      )}
      title={`${count} чек-ин(ов) за 30 дней`}
    >
      {SENTIMENT_CHIP_LABEL[sentiment]}
    </span>
  );
}

function ThemeChip({ theme }: { theme: TeamDetailThemeDomain }) {
  return (
    <li>
      <Link
        href={`/themes/${encodeURIComponent(theme.themeId)}`}
        className="inline-flex items-center gap-1.5 rounded-full bg-bg-card px-3 py-1.5 text-sm text-fg-primary shadow-card-soft transition-colors hover:text-accent"
      >
        <Hash size={12} className="text-fg-tertiary" />
        {theme.themeName}
        <span className="ml-1 text-xs text-fg-tertiary">{theme.blocksCount}</span>
      </Link>
    </li>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-overlay text-xs font-medium text-fg-secondary">
      {initials || '·'}
    </div>
  );
}

function formatSigned(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

function pluralizePeople(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'участник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return 'участника';
  return 'участников';
}
