'use client';

/**
 * IncidentsClient — `/admin/incidents` (admin-redesign Фаза 1).
 *
 * Вкладки:
 *   - «Сейчас горит» — все очереди с failed > 0, бейдж серьёзности.
 *   - «Очереди» — полная таблица. При клике на failed раскрывается список
 *     последних 3 failed-jobs со stacktrace excerpt.
 *   - «История 7д» — заглушка (Фаза 8).
 *   - «Правила алертов» — MVP-стаб: форма создания с отключённой submit,
 *     toast «Правила алертов будут запущены в Фазе 8».
 *
 * Если бэкенд не реализован — `AdminEmpty`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flame, History, ListTree, Siren } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminIncidentsApi } from '@/api/admin-incidents.api';
import {
  incidentFailedJobsListFromApi,
  incidentQueuesListFromApi,
  type IncidentFailedJobDomain,
  type IncidentQueueDomain,
} from '@/domain/admin-incidents';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';

const TABS: AdminTabDef[] = [
  { value: 'burning', label: 'Сейчас горит', icon: Flame },
  { value: 'queues', label: 'Очереди', icon: ListTree },
  { value: 'history', label: 'История 7 дней', icon: History },
  { value: 'rules', label: 'Правила алертов', icon: Siren },
];

export function IncidentsClient() {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Пульс', href: '/admin' },
        { label: 'Инциденты' },
      ]}
      title="Инциденты"
      description="Очереди с ошибками, последние неудачи воркеров и правила алертов."
    >
      <AdminTabs tabs={TABS} defaultTab="burning">
        {(active) => (
          <>
            {active === 'burning' && <BurningTab />}
            {active === 'queues' && <QueuesTab />}
            {active === 'history' && <HistoryTab />}
            {active === 'rules' && <RulesTab />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Hook: подгрузка очередей.

function useQueues(): {
  isLoading: boolean;
  isForbidden: boolean;
  error: string | null;
  notImplemented: boolean;
  data: IncidentQueueDomain[];
  refetch: () => void;
} {
  const q = useAdminQuery(
    'admin-incidents-queues',
    async () => {
      try {
        const res = await adminIncidentsApi.listQueues();
        return incidentQueuesListFromApi(res).items;
      } catch (e) {
        if (
          e instanceof ApiError &&
          (e.code === 'http_404' || e.code === 'not_found')
        ) {
          return null;
        }
        throw e;
      }
    },
    [],
  );

  return {
    isLoading: q.isLoading,
    isForbidden: q.isForbidden,
    error: q.error,
    notImplemented: !q.isLoading && q.data === null,
    data: q.data ?? [],
    refetch: q.refetch,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Вкладка «Сейчас горит».

function BurningTab() {
  const queues = useQueues();

  if (queues.isLoading) return <AdminLoading rows={3} />;
  if (queues.isForbidden) return <AdminForbidden />;
  if (queues.notImplemented) {
    return (
      <AdminEmpty
        title="Раздел будет наполнен в этой же фазе"
        description="Если видишь это после деплоя — обновится при следующем релизе бэкенда."
      />
    );
  }
  if (queues.error)
    return <AdminError message={queues.error} onRetry={queues.refetch} />;

  const burning = queues.data.filter((q) => q.failed > 0);

  if (burning.length === 0) {
    return (
      <AdminEmpty
        title="Сейчас всё спокойно"
        description="Ни в одной очереди нет неудачных задач."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {burning.map((q) => (
        <Card key={q.queueName}>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-sm">{q.queueName}</span>
              <SeverityBadge severity={q.severity} />
            </div>
            <div className="text-2xl font-semibold text-warning">
              {q.failed.toLocaleString('ru-RU')}
            </div>
            <div className="mt-1 text-xs text-fg-tertiary">
              неудачных задач
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Вкладка «Очереди»: таблица + раскрытие failed.

function QueuesTab() {
  const queues = useQueues();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (queues.isLoading) return <AdminLoading rows={6} />;
  if (queues.isForbidden) return <AdminForbidden />;
  if (queues.notImplemented) {
    return (
      <AdminEmpty
        title="Раздел будет наполнен в этой же фазе"
        description="Если видишь это после деплоя — обновится при следующем релизе бэкенда."
      />
    );
  }
  if (queues.error)
    return <AdminError message={queues.error} onRetry={queues.refetch} />;

  if (queues.data.length === 0) {
    return (
      <AdminEmpty
        title="Очереди не зарегистрированы"
        description="Запусти отдельный процесс bun run worker:dev — он зарегистрирует воркеров."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Имя</th>
                <th className="px-3 py-2 text-right">в ожидании</th>
                <th className="px-3 py-2 text-right">активные</th>
                <th className="px-3 py-2 text-right">отложенные</th>
                <th className="px-3 py-2 text-right">неудачные</th>
                <th className="px-3 py-2 text-right">завершённые</th>
              </tr>
            </thead>
            <tbody>
              {queues.data.map((q) => (
                <FragmentRow
                  key={q.queueName}
                  queue={q}
                  isExpanded={expanded === q.queueName}
                  onToggle={() =>
                    setExpanded((cur) =>
                      cur === q.queueName ? null : q.queueName,
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentRow({
  queue,
  isExpanded,
  onToggle,
}: {
  queue: IncidentQueueDomain;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-border-subtle">
        <td className="px-3 py-2 font-mono text-xs">{queue.queueName}</td>
        <td className="px-3 py-2 text-right tabular-nums">{queue.waiting}</td>
        <td className="px-3 py-2 text-right tabular-nums">{queue.active}</td>
        <td className="px-3 py-2 text-right tabular-nums">{queue.delayed}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {queue.failed > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-sm px-1 text-warning underline-offset-2 hover:underline"
            >
              {queue.failed}
            </button>
          ) : (
            <span className="text-fg-tertiary">0</span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-fg-tertiary">
          {queue.completed.toLocaleString('ru-RU')}
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-t border-border-subtle">
          <td colSpan={6} className="bg-bg-overlay/40 px-3 py-3">
            <FailedJobsList queueName={queue.queueName} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FailedJobsList({ queueName }: { queueName: string }) {
  const [items, setItems] = useState<IncidentFailedJobDomain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notImpl, setNotImpl] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setNotImpl(false);
    try {
      const res = await adminIncidentsApi.listFailedJobs(queueName, 3);
      setItems(incidentFailedJobsListFromApi(res).items);
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === 'http_404' || e.code === 'not_found')
      ) {
        setNotImpl(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    }
  }, [queueName]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notImpl) {
    return (
      <p className="text-xs text-fg-tertiary">
        Бэкенд list-failed-jobs ещё не реализован — увидим в следующем релизе.
      </p>
    );
  }
  if (error) {
    return <p className="text-xs text-danger">{error}</p>;
  }
  if (!items) {
    return <p className="text-xs text-fg-tertiary">Загружаем…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-xs text-fg-tertiary">
        Failed-задач в этой очереди нет.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((j) => (
        <li
          key={j.id}
          className="rounded-md border border-border-subtle bg-bg-card p-3 text-xs"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono">{j.name || j.id}</span>
            <span className="text-fg-tertiary">
              {j.failedAt.toLocaleString('ru-RU')} · попытка {j.attemptsMade}
            </span>
          </div>
          <div className="mb-1 text-danger">{j.failedReason}</div>
          {j.stacktraceExcerpt ? (
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-fg-tertiary">
              {j.stacktraceExcerpt}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Вкладка «История 7 дней» — заглушка.

function HistoryTab() {
  return (
    <AdminEmpty
      title="История инцидентов появится позже"
      description="Будет наполнено в Фазе 8 — раздел «Воркеры» и таблица `CronRunHistory`."
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Вкладка «Правила алертов» — MVP-стаб.

function RulesTab() {
  const [form, setForm] = useState({
    name: '',
    metric: 'failed_jobs',
    condition: '>',
    threshold: '5',
    channel: 'telegram',
    enabled: true,
  });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    toast.message('Правила алертов будут запущены в Фазе 8', {
      description: 'Сейчас сохранение в БД не работает. Форма — превью UX.',
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-4 max-w-prose text-sm text-fg-secondary">
          Создание правила: какую метрику следить, какой порог, куда отправлять
          уведомление. <strong>MVP-превью</strong> — отправка отключена,
          бэкенд-логика появится в Фазе 8 (раздел «Воркеры»).
        </p>

        <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rule-name">Название</Label>
            <Input
              id="rule-name"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="Например, «много failed-задач в transcribe»"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="rule-metric">Метрика</Label>
              <Select
                value={form.metric}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, metric: v }))
                }
              >
                <SelectTrigger id="rule-metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="failed_jobs">
                    Неудачные задачи в очереди
                  </SelectItem>
                  <SelectItem value="queue_waiting">
                    Размер очереди ожидания
                  </SelectItem>
                  <SelectItem value="latency_p99">
                    Задержка p99 (мс)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-condition">Условие</Label>
              <Select
                value={form.condition}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, condition: v }))
                }
              >
                <SelectTrigger id="rule-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=">">больше</SelectItem>
                  <SelectItem value="<">меньше</SelectItem>
                  <SelectItem value="==">равно</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-threshold">Порог</Label>
              <Input
                id="rule-threshold"
                type="number"
                value={form.threshold}
                onChange={(e) =>
                  setForm((s) => ({ ...s, threshold: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rule-channel">Канал уведомлений</Label>
            <Select
              value={form.channel}
              onValueChange={(v) => setForm((s) => ({ ...s, channel: v }))}
            >
              <SelectTrigger id="rule-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="telegram">Telegram</SelectItem>
                <SelectItem value="email">Электронная почта</SelectItem>
                <SelectItem value="web-push">Web-push</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="rule-enabled"
              checked={form.enabled}
              onCheckedChange={(v) => setForm((s) => ({ ...s, enabled: v }))}
            />
            <Label htmlFor="rule-enabled">Правило включено</Label>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled>
              Сохранить правило
            </Button>
            <span className="text-xs text-fg-tertiary">
              Сохранение отключено — действует в Фазе 8.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SeverityBadge.

function SeverityBadge({
  severity,
}: {
  severity: IncidentQueueDomain['severity'];
}) {
  if (severity === 'critical')
    return <Badge variant="danger">критично</Badge>;
  if (severity === 'warning')
    return <Badge variant="warning">внимание</Badge>;
  return <Badge variant="secondary">норма</Badge>;
}
