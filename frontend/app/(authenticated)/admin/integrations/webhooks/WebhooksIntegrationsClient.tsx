'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, RotateCcw, Webhook } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminWebhooksMgmtApi } from '@/api/admin-webhooks-mgmt.api';
import {
  webhookDeliveriesPageFromApi,
  type WebhookDeliveryDomain,
  type WebhookDeliveryStatusApi,
} from '@/domain/admin-webhook-mgmt';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import { AdminWebhooksClient } from '../../webhooks/AdminWebhooksClient';
import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const TABS: AdminTabDef[] = [
  { value: 'active', label: 'Активные', icon: Webhook },
  { value: 'deliveries', label: 'История доставок', icon: RefreshCw },
  { value: 'dlq', label: 'DLQ', icon: RotateCcw },
];

/**
 * `/admin/integrations/webhooks` — расширенное управление webhook-подписками.
 *
 * Три вкладки:
 *   - «Активные» — реиспользует существующий `AdminWebhooksClient`
 *     (из `/admin/webhooks`), отображает webhook'и текущей Org оператора.
 *   - «История доставок» — глобальный поток `WebhookDelivery` (cursor pagination,
 *     фильтры по `status`/`url`). Источник: `adminWebhooksMgmtApi.listDeliveries`.
 *   - «DLQ» — failed-only с кнопкой «Повторить» (`retryDelivery`).
 *
 * При отсутствии backend-эндпоинта показываем `AdminEmpty`.
 */
export function WebhooksIntegrationsClient() {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Каналы и интеграции' },
        { label: 'Webhook subscriptions' },
      ]}
      title="Webhook subscriptions"
      description="Подписки на исходящие события (HTTP-уведомления). Активные подписки — CRUD внутри текущей Org. История доставок и DLQ — глобально по всей платформе."
    >
      <AdminTabs tabs={TABS} defaultTab="active">
        {(active) => {
          if (active === 'active') return <ActiveTab />;
          if (active === 'deliveries') return <DeliveriesTab mode="all" />;
          if (active === 'dlq') return <DeliveriesTab mode="dlq" />;
          return null;
        }}
      </AdminTabs>
    </AdminSection>
  );
}

// ─────────────────────────── Активные ───────────────────────────

function ActiveTab() {
  // Реиспользуем существующий клиент: он сам подгружает webhook'и
  // текущей Org через `useWebhooks` и предоставляет «Тестовая отправка».
  // Оборачиваем тонкой подсказкой в шапке.
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-border-subtle bg-bg-overlay/40 px-3 py-2 text-xs text-fg-tertiary">
        Подписки текущей Org оператора. Создание / удаление — раздел Org-admin
        конкретной компании. Здесь — только просмотр и тестовая отправка.
      </div>
      <AdminWebhooksClient />
    </div>
  );
}

// ─────────────────────────── Доставки / DLQ ───────────────────────────

type DeliveriesMode = 'all' | 'dlq';

function DeliveriesTab({ mode }: { mode: DeliveriesMode }) {
  const [statusFilter, setStatusFilter] = useState<
    WebhookDeliveryStatusApi | 'all'
  >(mode === 'dlq' ? 'failed' : 'all');
  const [urlFilter, setUrlFilter] = useState('');
  const [appliedUrl, setAppliedUrl] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const q = useAdminQuery(
    `admin-webhook-deliveries:${mode}:${statusFilter}:${appliedUrl}`,
    async () => {
      if (mode === 'dlq') {
        const res = await adminWebhooksMgmtApi.listDlq({ limit: 50 });
        return webhookDeliveriesPageFromApi(res);
      }
      const res = await adminWebhooksMgmtApi.listDeliveries({
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(appliedUrl ? { url: appliedUrl } : {}),
        limit: 50,
      });
      return webhookDeliveriesPageFromApi(res);
    },
    [mode, statusFilter, appliedUrl],
  );

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      await adminWebhooksMgmtApi.retryDelivery(id);
      toast.success('Доставка поставлена в очередь повторно');
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось повторить доставку',
      );
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {mode === 'all' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-tertiary">Статус</label>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as WebhookDeliveryStatusApi | 'all')
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Все" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="success">Доставлено</SelectItem>
                <SelectItem value="failed">Ошибка</SelectItem>
                <SelectItem value="pending">В очереди</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-tertiary">URL содержит</label>
            <div className="flex gap-1">
              <Input
                value={urlFilter}
                onChange={(e) => setUrlFilter(e.target.value)}
                placeholder="example.com"
                className="w-[260px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setAppliedUrl(urlFilter.trim());
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAppliedUrl(urlFilter.trim())}
              >
                Применить
              </Button>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={q.refetch}>
            <RefreshCw size={14} /> Обновить
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-fg-tertiary">
            Все failed-доставки, для которых исчерпан retry-бюджет. Кнопка
            «Повторить» помещает доставку обратно в очередь.
          </p>
          <Button size="sm" variant="ghost" onClick={q.refetch}>
            <RefreshCw size={14} /> Обновить
          </Button>
        </div>
      )}

      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.items.length === 0 && (
        <AdminEmpty
          title={mode === 'dlq' ? 'DLQ пуст' : 'Доставок нет'}
          description={
            mode === 'dlq'
              ? 'Failed-доставок, требующих внимания, нет. Это хорошие новости.'
              : 'Под указанные фильтры ни одна доставка не подошла.'
          }
        />
      )}
      {!q.isLoading && q.data && q.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-left">Событие</th>
                <th className="px-3 py-2 text-left">URL</th>
                <th className="px-3 py-2 text-left">HTTP</th>
                <th className="px-3 py-2 text-right">Попытка</th>
                <th className="px-3 py-2 text-left">Создано</th>
                {mode === 'dlq' ? (
                  <th className="px-3 py-2 text-right">Действия</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <DeliveryRow
                  key={d.id}
                  delivery={d}
                  showRetry={mode === 'dlq'}
                  isRetrying={retryingId === d.id}
                  onRetry={() => void handleRetry(d.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeliveryRow({
  delivery,
  showRetry,
  isRetrying,
  onRetry,
}: {
  delivery: WebhookDeliveryDomain;
  showRetry: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const variant: 'success' | 'danger' | 'warning' =
    delivery.status === 'success'
      ? 'success'
      : delivery.status === 'failed'
        ? 'danger'
        : 'warning';
  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-2">
        <Badge variant={variant} className="text-[10px]">
          {delivery.statusLabel}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs font-mono text-fg-secondary">
        {delivery.eventType}
      </td>
      <td
        className="max-w-[260px] truncate px-3 py-2 text-xs font-mono text-fg-secondary"
        title={delivery.webhookUrl}
      >
        {delivery.webhookUrl}
      </td>
      <td className="px-3 py-2 text-xs">
        {delivery.httpStatus !== null ? delivery.httpStatus : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs">
        {delivery.attempt}
      </td>
      <td className="px-3 py-2 text-xs text-fg-tertiary">
        {delivery.createdAt.toLocaleString('ru-RU')}
      </td>
      {showRetry ? (
        <td className="px-3 py-2 text-right">
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            Повторить
          </Button>
        </td>
      ) : null}
    </tr>
  );
}
