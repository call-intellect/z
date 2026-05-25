'use client';

/**
 * HealthQueuesTab — вкладка «Очереди» внутри /admin/health.
 *
 * Источник данных: `GET /api/v1/admin/health/queues` (Фаза 1 ТЗ admin-redesign).
 * Если эндпоинт ещё не реализован — fallback на старый объединённый
 * `GET /api/v1/admin/health` (Фаза 7), пока сохраняем совместимость.
 */

import { ApiError } from '@/api/api-error';
import { apiClient } from '@/api/api-client';
import { adminHealthApi } from '@/api/admin-health.api';
import {
  adminHealthFromApi,
  type AdminHealthApi,
  type AdminQueueCountsDomain,
} from '@/domain/admin-health';
import { Card, CardContent } from '@/ui/shadcn/card';

import {
  AdminEmpty,
  AdminError,
  AdminLoading,
} from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';

export function HealthQueuesTab() {
  const q = useAdminQuery(
    'admin-health-queues',
    async () => {
      try {
        // Целевой эндпоинт.
        return await apiClient.get<{ queues: AdminHealthApi['queues'] }>(
          '/api/v1/admin/health/queues',
        );
      } catch (e) {
        // 404 — бэкенд ещё не реализован. Откатимся на общий /admin/health.
        if (
          e instanceof ApiError &&
          (e.code === 'http_404' || e.code === 'not_found')
        ) {
          const merged = await adminHealthApi.get();
          return { queues: merged.queues };
        }
        throw e;
      }
    },
    [],
  );

  if (q.isLoading) return <AdminLoading rows={6} />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) {
    return (
      <AdminEmpty
        title="Раздел будет наполнен в этой же фазе"
        description="Если видишь это после деплоя — обновится при следующем релизе бэкенда."
      />
    );
  }

  const domain = adminHealthFromApi({
    queues: q.data.queues,
    database: {
      sizeBytes: null,
      ideaBlocksTotal: 0,
      entitiesTotal: 0,
      rawEventsTotal: 0,
      aiUsageLogTotal: 0,
    },
    redis: { available: true },
    s3: { available: 'unknown' },
    generatedAt: new Date().toISOString(),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <QueuesTable queues={domain.queues} />
      </CardContent>
    </Card>
  );
}

function QueuesTable({ queues }: { queues: AdminQueueCountsDomain[] }) {
  if (queues.length === 0) {
    return (
      <AdminEmpty
        title="Очереди не зарегистрированы"
        description="Воркеры BullMQ ещё не отчитались. Подожди ~30 секунд после старта worker-процесса."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-2 py-1 text-left">Очередь</th>
            <th className="px-2 py-1 text-right">в ожидании</th>
            <th className="px-2 py-1 text-right">активные</th>
            <th className="px-2 py-1 text-right">отложенные</th>
            <th className="px-2 py-1 text-right">неудачные</th>
            <th className="px-2 py-1 text-right">завершённые</th>
          </tr>
        </thead>
        <tbody>
          {queues.map((q) => (
            <tr key={q.queueName} className="border-t border-border-subtle">
              <td className="px-2 py-1 font-mono text-xs">{q.queueName}</td>
              <td className="px-2 py-1 text-right tabular-nums">{q.waiting}</td>
              <td className="px-2 py-1 text-right tabular-nums">{q.active}</td>
              <td className="px-2 py-1 text-right tabular-nums">{q.delayed}</td>
              <td
                className={`px-2 py-1 text-right tabular-nums ${
                  q.failed > 0 ? 'text-warning' : ''
                }`}
              >
                {q.failed}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-fg-tertiary">
                {q.completed.toLocaleString('ru-RU')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
