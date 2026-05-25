'use client';

import { useState } from 'react';
import {
  AlertOctagon,
  BarChart3,
  MessageSquare,
  ThumbsUp,
} from 'lucide-react';

import { adminConciergeAnalyticsApi } from '@/api/admin-concierge-analytics.api';
import {
  adminConciergeNoAnswerFromApi,
  adminConciergeOverviewFromApi,
  adminConciergeTopQueriesFromApi,
  type AdminConciergeNoAnswerRowDomain,
  type AdminConciergeTopQueryApi,
} from '@/domain/admin-concierge-analytics';
import {
  ADMIN_PERIOD_LABELS,
  formatDurationMs,
  type AdminPeriod,
} from '@/domain/admin-usage';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs } from '@/ui/components/admin/AdminTabs';
import { AdminCsvDownloadButton } from '@/ui/components/admin/AdminCsvDownloadButton';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];

/**
 * Аналитика Concierge / AI-чата: объём, no-answer rate, средняя задержка,
 * топ-запросы, лента «не ответил».
 *
 * Бэкенд `/api/v1/admin/analytics/concierge/*` готовится параллельно. Любой
 * 404/501 показывает `AdminEmpty` с пометкой про chat-модуль.
 */
export function ConciergeAnalyticsClient() {
  const [period, setPeriod] = useState<AdminPeriod>('week');

  return (
    <AdminSection
      title="Concierge и AI-чат"
      description="Сколько вопросов задают, на сколько мы отвечаем, что не покрывается, обратная связь."
      actions={
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as AdminPeriod)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {ADMIN_PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <AdminTabs
        tabs={[
          { value: 'overview', label: 'Обзор', icon: BarChart3 },
          { value: 'top-queries', label: 'Запросы', icon: MessageSquare },
          { value: 'no-answer', label: 'No-answer', icon: AlertOctagon },
          { value: 'feedback', label: 'Feedback', icon: ThumbsUp },
        ]}
      >
        {(tab) => (
          <>
            {tab === 'overview' && <OverviewTab period={period} />}
            {tab === 'top-queries' && <TopQueriesTab period={period} />}
            {tab === 'no-answer' && <NoAnswerTab period={period} />}
            {tab === 'feedback' && <FeedbackTab />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

// ─── Обзор ────────────────────────────────────────────────────────────────

function OverviewTab({ period }: { period: AdminPeriod }) {
  const q = useAdminQuery(
    `admin-concierge-overview:${period}`,
    async () => {
      const res = await adminConciergeAnalyticsApi.overview({ period });
      return adminConciergeOverviewFromApi(res);
    },
    [period],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) {
    return (
      <AdminEmpty
        title="Нет данных"
        description="Будет подключено к chat-модулю."
      />
    );
  }

  const t = q.data.totals;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="Всего вопросов"
        value={t.totalQuestions.toLocaleString('ru-RU')}
      />
      <KpiCard
        title="Доля «не ответил»"
        value={`${(t.noAnswerRate * 100).toFixed(1)}%`}
        hint={`${t.noAnswerCount.toLocaleString('ru-RU')} запросов`}
        tone={t.noAnswerRate > 0.1 ? 'warning' : undefined}
      />
      <KpiCard
        title="Средняя задержка"
        value={formatDurationMs(t.avgLatencyMs)}
      />
      <KpiCard
        title="Активных пользователей"
        value={t.activeUsers.toLocaleString('ru-RU')}
      />
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: 'warning';
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-fg-tertiary">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === 'warning' ? 'text-warning' : ''
          }`}
        >
          {value}
        </div>
        {hint ? (
          <div className="mt-1 text-[11px] text-fg-tertiary">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Top queries ──────────────────────────────────────────────────────────

function TopQueriesTab({ period }: { period: AdminPeriod }) {
  const q = useAdminQuery(
    `admin-concierge-top:${period}`,
    async () => {
      const res = await adminConciergeAnalyticsApi.topQueries({
        period,
        limit: 20,
      });
      return adminConciergeTopQueriesFromApi(res);
    },
    [period],
  );

  if (q.isLoading) return <AdminLoading rows={6} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data || q.data.items.length === 0) {
    return (
      <AdminEmpty
        title="Нет данных"
        description="За выбранный период никто ничего не спрашивал, либо chat-модуль ещё не подключён."
      />
    );
  }

  return <TopQueriesTable items={q.data.items} period={period} />;
}

function TopQueriesTable({
  items,
  period,
}: {
  items: AdminConciergeTopQueryApi[];
  period: AdminPeriod;
}) {
  const csvRows: Array<Record<string, unknown>> = items.map((q) => ({
    query: q.query,
    count: q.count,
    avgLatencyMs: q.avgLatencyMs,
    successRatePct: (q.successRate * 100).toFixed(2),
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AdminCsvDownloadButton
          rows={csvRows}
          columns={[
            { key: 'query', label: 'Запрос' },
            { key: 'count', label: 'Раз' },
            { key: 'avgLatencyMs', label: 'Avg latency, ms' },
            { key: 'successRatePct', label: 'Success rate, %' },
          ]}
          filename={`admin-concierge-top-queries-${period}.csv`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Запрос</th>
              <th className="px-3 py-2 text-right">Раз</th>
              <th className="px-3 py-2 text-right">Avg latency</th>
              <th className="px-3 py-2 text-right">Success rate</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, idx) => (
              <tr
                key={`${row.query}-${idx}`}
                className="border-t border-border-subtle hover:bg-bg-overlay"
              >
                <td className="px-3 py-2">
                  <span className="line-clamp-2">{row.query}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.count.toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDurationMs(row.avgLatencyMs)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    row.successRate < 0.8 ? 'text-warning' : ''
                  }`}
                >
                  {(row.successRate * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── No-answer ────────────────────────────────────────────────────────────

function NoAnswerTab({ period }: { period: AdminPeriod }) {
  const q = useAdminQuery(
    `admin-concierge-no-answer:${period}`,
    async () => {
      const res = await adminConciergeAnalyticsApi.noAnswer({
        period,
        limit: 50,
      });
      return adminConciergeNoAnswerFromApi(res);
    },
    [period],
  );

  if (q.isLoading) return <AdminLoading rows={6} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data || q.data.items.length === 0) {
    return (
      <AdminEmpty
        title="Все вопросы получили ответ"
        description="Либо chat-модуль ещё не подключён к analytics."
      />
    );
  }

  return <NoAnswerList items={q.data.items} period={period} />;
}

function NoAnswerList({
  items,
  period,
}: {
  items: AdminConciergeNoAnswerRowDomain[];
  period: AdminPeriod;
}) {
  const csvRows: Array<Record<string, unknown>> = items.map((r) => ({
    createdAt: r.createdAt.toISOString(),
    query: r.query,
    userEmail: r.userEmail ?? '',
    tenantName: r.tenantName ?? '',
    reason: r.reason ?? '',
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AdminCsvDownloadButton
          rows={csvRows}
          columns={[
            { key: 'createdAt', label: 'Когда' },
            { key: 'query', label: 'Запрос' },
            { key: 'userEmail', label: 'Пользователь' },
            { key: 'tenantName', label: 'Org' },
            { key: 'reason', label: 'Причина' },
          ]}
          filename={`admin-concierge-no-answer-${period}.csv`}
        />
      </div>
      <ul className="space-y-2">
        {items.map((row) => (
          <li
            key={row.id}
            className="rounded-lg border border-border-subtle bg-bg-card p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-fg-primary">{row.query}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-tertiary">
                  <span>{row.createdAt.toLocaleString('ru-RU')}</span>
                  {row.userEmail && (
                    <span className="rounded bg-bg-overlay px-1.5 py-0.5">
                      {row.userEmail}
                    </span>
                  )}
                  {row.tenantName && (
                    <span className="rounded bg-bg-overlay px-1.5 py-0.5">
                      {row.tenantName}
                    </span>
                  )}
                </div>
              </div>
              {row.reason && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
                  {row.reason}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Feedback ─────────────────────────────────────────────────────────────

function FeedbackTab() {
  return (
    <AdminEmpty
      title="Будет в Фазе 9"
      description="Сбор отзывов на ответы Concierge (палец вверх/вниз, текстовый фидбек) — отдельная подсистема. Появится после релиза chat-модуля."
    />
  );
}
