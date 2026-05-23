'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  conciergeApi,
  type ConciergeConversationApi,
  type ConciergeQuotaApi,
} from '@/api/concierge.api';
import { ConciergeChat } from '@/ui/concierge/ConciergeChat';

/**
 * SBA γ-2 — `/assistant` страница.
 *
 * Layout: 2 колонки.
 *   - Sidebar (320px) — список диалогов + квота.
 *   - Main — ConciergeChat (новый или продолжение conversation).
 */
export function AssistantClient() {
  const [conversations, setConversations] = useState<ConciergeConversationApi[]>(
    [],
  );
  const [quota, setQuota] = useState<ConciergeQuotaApi | null>(null);
  const [activeConv, setActiveConv] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [convs, q] = await Promise.all([
        conciergeApi.listConversations(false, 1, 50),
        conciergeApi.getQuota(),
      ]);
      setConversations(convs.items);
      setQuota(q);
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-[80vh] flex-col bg-bg-base text-fg-primary md:flex-row">
      <aside className="w-full border-b border-border-subtle bg-bg-overlay md:w-80 md:border-b-0 md:border-r">
        <div className="p-3">
          <button
            type="button"
            className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-600"
            onClick={() => setActiveConv(undefined)}
          >
            + Новый диалог
          </button>
        </div>
        <div className="px-3 text-xs uppercase text-fg-tertiary">
          Мои диалоги
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-xs text-fg-tertiary">Загрузка…</div>
          )}
          {!loading && conversations.length === 0 && (
            <div className="px-3 py-2 text-xs text-fg-tertiary">
              Пока нет диалогов
            </div>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveConv(c.id)}
              className={
                'block w-full truncate px-3 py-2 text-left text-xs hover:bg-bg-base ' +
                (activeConv === c.id ? 'bg-bg-base font-semibold' : '')
              }
            >
              {c.summary ?? `Диалог от ${formatShortDate(c.startedAt)}`}
            </button>
          ))}
        </div>
        {quota && (
          <div className="border-t border-border-subtle p-3 text-xs text-fg-tertiary">
            Квота: сегодня {quota.dailyUsed}/{quota.dailyLimit} · месяц{' '}
            {quota.monthlyUsed}/{quota.monthlyLimit}
          </div>
        )}
      </aside>
      <main className="flex flex-1 flex-col p-3">
        <ConciergeChat
          {...(activeConv ? { conversationId: activeConv } : {})}
          className="flex h-full flex-1 flex-col rounded-md border border-border-subtle bg-bg-base"
          onConversationStarted={(id) => {
            setActiveConv(id);
            void refresh();
          }}
        />
      </main>
    </div>
  );
}

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
