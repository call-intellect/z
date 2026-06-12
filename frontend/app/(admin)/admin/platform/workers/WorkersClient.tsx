'use client';

/**
 * `/admin/platform/workers` — BullMQ inspector. Фаза 8 редизайна Z-Admin.
 *
 * Колонки: name / waiting / active / failed / delayed / completed / pause toggle / Actions.
 * Details — `WorkerQueueDetailDialog` с failed/completed jobs и кнопками
 * Remove для каждого failed.
 * Retry failed — POST /queues/:name/retry-failed с подтверждением.
 */

import { useState } from 'react';
import { Eye, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { adminWorkersApi } from '@/api/admin-workers.api';
import { ApiError } from '@/api/api-error';
import {
  workerQueueFromApi,
  type WorkerQueueDomain,
} from '@/domain/admin-worker';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { DangerAction } from '@/ui/components/admin/AdminDangerZone';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { WorkerQueueDetailDialog } from './WorkerQueueDetailDialog';
import { adminRootCrumb } from '@/ui/components/admin/brand';

export function WorkersClient() {
  const [detailName, setDetailName] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const q = useAdminQuery('admin-platform-workers', async () => {
    const res = await adminWorkersApi.listQueues();
    return res.map(workerQueueFromApi);
  });

  const handleTogglePause = async (qu: WorkerQueueDomain) => {
    setBusyName(qu.name);
    try {
      if (qu.paused) {
        await adminWorkersApi.resume(qu.name);
        toast.success(`Очередь «${qu.name}» возобновлена`);
      } else {
        await adminWorkersApi.pause(qu.name);
        toast.success(`Очередь «${qu.name}» приостановлена`);
      }
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось переключить состояние',
      );
    } finally {
      setBusyName(null);
    }
  };

  const handleRetryFailed = async (qu: WorkerQueueDomain) => {
    try {
      const res = await adminWorkersApi.retryFailed(qu.name);
      toast.success(
        `Перезапуск задач «${qu.name}»: ${res.retried ?? 0} шт.`,
      );
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось перезапустить задачи',
      );
      throw e;
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Платформа' },
        { label: 'Воркеры BullMQ' },
      ]}
      title="BullMQ воркеры"
      description="Состояние всех BullMQ-очередей и фоновых задач. Пауза/возобновление, перезапуск failed-задач, удаление зависших job-ов."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => q.refetch()}
          disabled={q.isLoading}
        >
          <RefreshCw size={14} className="mr-1" aria-hidden />
          Обновить
        </Button>
      }
    >
      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.error && !q.isForbidden && !q.data ? (
        <AdminEmpty
          title="BullMQ inspector недоступен"
          description="Бэкенд-эндпоинт /api/v1/admin/workers/queues ещё не реализован. Управление перейдёт сюда после Фазы 8 (backend)."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.length === 0 ? (
        <AdminEmpty
          title="Очередей нет"
          description="Ни одной зарегистрированной очереди. Проверьте, что воркер запущен (workers/main.ts)."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.length > 0 ? (
        <QueuesTable
          rows={q.data}
          busyName={busyName}
          onTogglePause={(qu) => void handleTogglePause(qu)}
          onRetryFailed={(qu) => handleRetryFailed(qu)}
          onShowDetails={(name) => setDetailName(name)}
        />
      ) : null}

      <WorkerQueueDetailDialog
        queueName={detailName}
        open={detailName !== null}
        onOpenChange={(open) => {
          if (!open) setDetailName(null);
        }}
        onJobRemoved={() => q.refetch()}
      />
    </AdminSection>
  );
}

function QueuesTable({
  rows,
  busyName,
  onTogglePause,
  onRetryFailed,
  onShowDetails,
}: {
  rows: WorkerQueueDomain[];
  busyName: string | null;
  onTogglePause: (qu: WorkerQueueDomain) => void;
  onRetryFailed: (qu: WorkerQueueDomain) => Promise<void>;
  onShowDetails: (name: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Очередь</th>
            <th className="px-3 py-2 text-right">Ждут</th>
            <th className="px-3 py-2 text-right">Активные</th>
            <th className="px-3 py-2 text-right">Ошибки</th>
            <th className="px-3 py-2 text-right">Отложены</th>
            <th className="px-3 py-2 text-right">Готовы</th>
            <th className="px-3 py-2 text-center">Пауза</th>
            <th className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((qu) => (
            <tr
              key={qu.name}
              className="border-t border-border-subtle align-top hover:bg-bg-overlay"
            >
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[11px] font-medium text-fg-primary">
                    {qu.name}
                  </code>
                  {qu.status === 'error' ? (
                    <Badge variant="danger" className="text-[10px]">
                      ошибки
                    </Badge>
                  ) : qu.status === 'paused' ? (
                    <Badge variant="warning" className="text-[10px]">
                      пауза
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{qu.waiting}</td>
              <td className="px-3 py-3 text-right tabular-nums">{qu.active}</td>
              <td
                className={`px-3 py-3 text-right tabular-nums ${qu.failed > 0 ? 'text-danger' : ''}`}
              >
                {qu.failed}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{qu.delayed}</td>
              <td className="px-3 py-3 text-right tabular-nums">{qu.completed}</td>
              <td className="px-3 py-3 text-center">
                <div className="flex items-center justify-center gap-2">
                  <Switch
                    checked={qu.paused}
                    onCheckedChange={() => onTogglePause(qu)}
                    disabled={busyName === qu.name}
                    aria-label={qu.paused ? 'Возобновить' : 'Поставить на паузу'}
                  />
                  {busyName === qu.name ? (
                    <Loader2
                      size={12}
                      className="animate-spin text-fg-tertiary"
                      aria-hidden
                    />
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onShowDetails(qu.name)}
                    title="Подробности (failed/completed)"
                  >
                    <Eye size={13} aria-hidden />
                    <span className="ml-1 hidden sm:inline">Детали</span>
                  </Button>
                  {qu.failed > 0 ? (
                    <DangerAction
                      label={`Retry failed (${qu.failed})`}
                      triggerVariant="outline"
                      title={`Перезапустить ${qu.failed} failed-задач(и)?`}
                      description={`Все failed-задачи очереди «${qu.name}» будут отправлены на повторное выполнение.`}
                      severity="medium"
                      confirmLabel="Перезапустить"
                      onConfirm={async () => onRetryFailed(qu)}
                    />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
