'use client';

import { Activity, AlertTriangle, CheckCircle2, Database } from 'lucide-react';

import { adminHealthApi } from '@/api/admin-health.api';
import { adminHealthFromApi } from '@/domain/admin-health';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';

export function HealthClient() {
  const q = useAdminQuery(
    'admin-health',
    async () => {
      const res = await adminHealthApi.get();
      return adminHealthFromApi(res);
    },
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Здоровье системы</h1>
          <p className="text-sm text-fg-tertiary">
            Очереди (BullMQ), размер БД, доступность Redis. Полный мониторинг —
            фаза 11.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={q.refetch}>
          Обновить
        </Button>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && (
        <>
          {/* Infra status row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <InfraStatusTile
              title="Redis"
              ok={q.data.redis.available}
              detail={q.data.redis.error ?? 'ping ok'}
            />
            <InfraStatusTile
              title="S3"
              ok={null}
              detail="мониторинг — фаза 11"
            />
            <Card>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-fg-tertiary">
                  <span>База данных</span>
                  <Database size={14} />
                </div>
                <div className="text-xl font-semibold">
                  {q.data.database.sizeFormatted}
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-fg-tertiary">
                  <div>{q.data.database.ideaBlocksTotal.toLocaleString('ru-RU')} idea_blocks</div>
                  <div>{q.data.database.entitiesTotal.toLocaleString('ru-RU')} entities</div>
                  <div>{q.data.database.rawEventsTotal.toLocaleString('ru-RU')} raw_events</div>
                  <div>{q.data.database.aiUsageLogTotal.toLocaleString('ru-RU')} ai_usage_log</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Queues table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Очереди BullMQ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-fg-tertiary">
                    <tr>
                      <th className="px-2 py-1 text-left">Queue</th>
                      <th className="px-2 py-1 text-right">waiting</th>
                      <th className="px-2 py-1 text-right">active</th>
                      <th className="px-2 py-1 text-right">delayed</th>
                      <th className="px-2 py-1 text-right">failed</th>
                      <th className="px-2 py-1 text-right">completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.queues.map((qq) => (
                      <tr key={qq.queueName} className="border-t border-border-subtle">
                        <td className="px-2 py-1 font-mono text-xs">{qq.queueName}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{qq.waiting}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{qq.active}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{qq.delayed}</td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums ${
                            qq.failed > 0 ? 'text-warning' : ''
                          }`}
                        >
                          {qq.failed}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-fg-tertiary">
                          {qq.completed.toLocaleString('ru-RU')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-fg-tertiary">
            <Activity size={11} className="mr-1 inline" />
            Сгенерировано: {q.data.generatedAt.toLocaleString('ru-RU')}
          </p>
        </>
      )}
    </div>
  );
}

function InfraStatusTile({
  title,
  ok,
  detail,
}: {
  title: string;
  ok: boolean | null;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-fg-tertiary">
          <span>{title}</span>
          {ok === true ? (
            <CheckCircle2 size={14} className="text-success" />
          ) : ok === false ? (
            <AlertTriangle size={14} className="text-danger" />
          ) : (
            <Activity size={14} />
          )}
        </div>
        <div className="text-base font-semibold">
          {ok === true ? (
            <Badge variant="default">OK</Badge>
          ) : ok === false ? (
            <Badge variant="danger">DOWN</Badge>
          ) : (
            <Badge variant="secondary">unknown</Badge>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-fg-tertiary">{detail}</div>
      </CardContent>
    </Card>
  );
}
