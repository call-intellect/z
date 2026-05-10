'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, FlaskConical, X } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { adminExperimentsApi } from '@/api/admin-experiments.api';
import {
  adminExperimentStatusFromApi,
  taskTypeLabel,
  type AdminExperimentMetricsApi,
} from '@/domain/admin-experiment';
import { formatDurationMs, formatUsd } from '@/domain/admin-usage';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { ExperimentStartDialog } from '../ExperimentStartDialog';

export function ExperimentClient({ taskType }: { taskType: string }) {
  const { addToast } = useToast();
  const [showStart, setShowStart] = useState(false);
  const [acting, setActing] = useState(false);

  const q = useAdminQuery(
    `admin-exp:${taskType}`,
    async () => {
      const res = await adminExperimentsApi.getStatus(taskType);
      return adminExperimentStatusFromApi(res);
    },
    [taskType],
  );

  const finish = async (winner: 'A' | 'B') => {
    if (
      !window.confirm(
        winner === 'B'
          ? 'Перевести функцию на model B и завершить эксперимент?'
          : 'Оставить model A (откатить эксперимент)?',
      )
    ) {
      return;
    }
    setActing(true);
    try {
      await adminExperimentsApi.finish(taskType, { winner });
      addToast({
        type: 'success',
        message: winner === 'B' ? 'Перевели на model B' : 'Откатили на model A',
      });
      q.refetch();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось завершить',
      });
    } finally {
      setActing(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm('Отменить эксперимент без миграции?')) return;
    setActing(true);
    try {
      await adminExperimentsApi.cancel(taskType);
      addToast({ type: 'success', message: 'Эксперимент отменён' });
      q.refetch();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось отменить',
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/experiments">
          <ArrowLeft size={14} /> К списку экспериментов
        </Link>
      </Button>

      <header>
        <h1 className="text-2xl font-semibold">
          A/B на {taskTypeLabel(taskType)}
        </h1>
        <p className="text-sm text-fg-tertiary">
          <code className="rounded bg-bg-overlay px-1.5 py-0.5 font-mono text-xs">
            {taskType}
          </code>
        </p>
      </header>

      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}

      {!q.isLoading && q.data && !q.data.config && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <AdminEmpty
              title="Эксперимент не запущен"
              description="Сейчас на этой функции эксперимента нет. Можно запустить новый."
            />
            <div className="flex justify-center">
              <Button onClick={() => setShowStart(true)}>
                <FlaskConical size={14} /> Запустить A/B
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!q.isLoading && q.data && q.data.config && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical size={16} className="text-accent" />
                Конфигурация
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void finish('A')}
                  disabled={acting}
                >
                  Откатить (A)
                </Button>
                <Button
                  size="sm"
                  onClick={() => void finish('B')}
                  disabled={acting}
                >
                  Перейти на B
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void cancel()}
                  disabled={acting}
                >
                  <X size={12} /> Отменить
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-fg-tertiary">Model A (текущая)</div>
                <code className="font-mono">{q.data.config.modelA}</code>
              </div>
              <div>
                <div className="text-xs text-fg-tertiary">Model B (кандидат)</div>
                <code className="font-mono">{q.data.config.modelB}</code>
              </div>
              <div>
                <div className="text-xs text-fg-tertiary">Split</div>
                {q.data.config.splitPercent}% B / {100 - q.data.config.splitPercent}% A
              </div>
              <div>
                <div className="text-xs text-fg-tertiary">Период</div>
                {q.data.config.startedAt?.toLocaleDateString('ru-RU')} —{' '}
                {q.data.config.endsAt?.toLocaleDateString('ru-RU')}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Метрики</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <MetricsBlock
                  group="A"
                  modelLabel={q.data.config.modelA}
                  metrics={q.data.metrics.A}
                />
                <MetricsBlock
                  group="B"
                  modelLabel={q.data.config.modelB}
                  metrics={q.data.metrics.B}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Последние вызовы (по 10 на группу)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RecentCallsList
                title={`Group A — ${q.data.config.modelA}`}
                items={q.data.recentCalls.A}
              />
              <RecentCallsList
                title={`Group B — ${q.data.config.modelB}`}
                items={q.data.recentCalls.B}
              />
            </CardContent>
          </Card>
        </>
      )}

      {showStart && (
        <ExperimentStartDialog
          taskType={taskType}
          onClose={() => setShowStart(false)}
          onStarted={() => {
            setShowStart(false);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

function MetricsBlock({
  group,
  modelLabel,
  metrics,
}: {
  group: 'A' | 'B';
  modelLabel: string;
  metrics: AdminExperimentMetricsApi;
}) {
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={group === 'B' ? 'default' : 'secondary'}>{group}</Badge>
        <code className="font-mono text-xs">{modelLabel}</code>
      </div>
      <dl className="space-y-1 text-sm">
        <Row label="Вызовов" value={metrics.totalCalls.toLocaleString('ru-RU')} />
        <Row
          label="Fail rate"
          value={`${(metrics.failRate * 100).toFixed(1)}% (${metrics.failedCalls})`}
        />
        <Row label="Avg cost" value={formatUsd(metrics.avgCostUsd)} />
        <Row label="Avg latency" value={formatDurationMs(metrics.avgDurationMs)} />
        <Row
          label="Avg in/out tokens"
          value={`${Math.round(metrics.avgInputTokens)} / ${Math.round(metrics.avgOutputTokens)}`}
        />
        <Row label="Total cost" value={formatUsd(metrics.totalCostUsd)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function RecentCallsList({
  title,
  items,
}: {
  title: string;
  items: ReturnType<
    typeof adminExperimentStatusFromApi
  >['recentCalls']['A'];
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-fg-tertiary">Пока нет вызовов</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-border-subtle p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-fg-tertiary">
                  {c.createdAt.toLocaleString('ru-RU')}
                </span>
                {c.success ? (
                  <Badge variant="secondary" className="text-[9px]">ok</Badge>
                ) : (
                  <Badge variant="danger" className="text-[9px]">fail</Badge>
                )}
              </div>
              <div className="mt-1 text-fg-tertiary">
                {c.inputTokens}/{c.outputTokens} токенов · {formatUsd(c.costUsd)} ·{' '}
                {formatDurationMs(c.durationMs)}
              </div>
              {c.responsePreview && (
                <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-overlay p-2 text-[10px]">
                  {c.responsePreview.slice(0, 600)}
                  {c.responsePreview.length > 600 ? '…' : ''}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
