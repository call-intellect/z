'use client';

/**
 * Таймлайн последних `SubscriptionEvent` для одной Org.
 *
 * Источник — `billingApi.adminGetEvents(tenantId)`. На MVP показываем все,
 * что отдал бэкенд (бэкенд сам ограничивает limit=100, см.
 * AdminBillingController.getEvents).
 *
 * Каждая строка: цветной бейдж типа, дата, инициатор (byUserId), reason,
 * accordion с payload (JSON). Используется в табе «Подписка и счета»
 * карточки Org `/admin/orgs/[id]?tab=subscription`.
 *
 * См. plans/tz/2026-05-29-admin-subscription-ui-v2.md (Фаза 3).
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { billingApi } from '@/api/billing.api';
import type { SubscriptionEventApi } from '@/api/types/billing';
import {
  subscriptionEventColor,
  subscriptionEventLabel,
  type SubscriptionEventColor,
} from '@/domain/billing';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

type Props = {
  tenantId: string;
};

export function SubscriptionEventsTimeline({ tenantId }: Props) {
  const [events, setEvents] = useState<SubscriptionEventApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await billingApi.adminGetEvents(tenantId);
      setEvents(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <h2 className="text-lg font-medium">История событий подписки</h2>
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <h2 className="text-lg font-medium">История событий подписки</h2>
        <p className="text-sm text-danger">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Повторить
        </Button>
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium">История событий подписки</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Событий ещё не было.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-medium">
          История событий подписки ({events.length})
        </h2>
        <p className="text-xs text-fg-tertiary mt-1">
          Последние операции с подпиской: активация, изменение мест,
          принудительные смены статуса. Источник — `SubscriptionEvent`.
        </p>
      </div>
      <ul className="divide-y">
        {events.map((ev) => (
          <EventRow
            key={ev.id}
            event={ev}
            expanded={expanded.has(ev.id)}
            onToggle={() => toggle(ev.id)}
          />
        ))}
      </ul>
    </div>
  );
}

const COLOR_CLASSES: Record<SubscriptionEventColor, string> = {
  green: 'bg-green-100 text-green-900 border border-green-200',
  amber: 'bg-amber-100 text-amber-900 border border-amber-200',
  red: 'bg-red-100 text-red-900 border border-red-200',
  blue: 'bg-blue-100 text-blue-900 border border-blue-200',
  slate: 'bg-slate-100 text-slate-900 border border-slate-200',
};

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: SubscriptionEventApi;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = subscriptionEventColor(event.eventType);
  const label = subscriptionEventLabel(event.eventType);
  const date = new Date(event.createdAt);

  let payloadJson = '';
  try {
    payloadJson = JSON.stringify(event.payload, null, 2);
  } catch {
    payloadJson = String(event.payload);
  }
  const hasPayload =
    event.payload !== null &&
    event.payload !== undefined &&
    payloadJson !== '{}' &&
    payloadJson !== 'null';

  return (
    <li className="px-6 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 text-fg-tertiary hover:text-fg-primary"
          aria-label={expanded ? 'Свернуть payload' : 'Развернуть payload'}
          aria-expanded={expanded}
          disabled={!hasPayload}
        >
          {hasPayload ? (
            expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : (
            <span className="inline-block w-[14px]" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={COLOR_CLASSES[color]}>{label}</Badge>
            <span className="text-xs text-fg-tertiary tabular-nums">
              {date.toLocaleString('ru-RU')}
            </span>
            {event.byUserId && (
              <span className="text-xs text-fg-tertiary">
                · кто:{' '}
                <code className="rounded bg-bg-overlay px-1 text-[10px]">
                  {event.byUserId}
                </code>
              </span>
            )}
          </div>
          {event.reason && (
            <p className="mt-1 text-xs text-fg-secondary">
              <span className="text-fg-tertiary">Причина:</span> {event.reason}
            </p>
          )}
          {expanded && hasPayload && (
            <pre className="mt-2 rounded-md border border-border-subtle bg-bg-overlay p-3 text-[11px] overflow-x-auto">
              {payloadJson}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}
