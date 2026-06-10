'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, MessagesSquare, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { chatboxApi, type ChatboxChatStatusApi } from '@/api/chatbox.api';
import {
  chatboxChannelTypeBadgeClass,
  chatboxChannelTypeLabel,
  chatboxChatStatusLabel,
  mapChat,
  type ChatboxChatView,
} from '@/domain/chatbox';
import { TierGate } from '@/ui/components/TierGate';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

const PAGE_SIZE = 30;
// Radix Select не принимает пустую строку как value — сентинел для «все мессенджеры».
const ALL_CHANNELS = '__all__';

type StatusFilter = 'all' | ChatboxChatStatusApi;

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('ru-RU');
}

export function ChatsListClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatsListContent />
    </TierGate>
  );
}

function ChatsListContent() {
  const router = useRouter();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [channelType, setChannelType] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const filters = useMemo(
    () => ({
      ...(status !== 'all' ? { status } : {}),
      ...(channelType.trim() ? { channelType: channelType.trim() } : {}),
      limit,
      offset: 0,
    }),
    [status, channelType, limit],
  );

  const { data, error, isLoading } = useSWR(
    ['chatbox-chats', filters],
    async () => {
      const res = await chatboxApi.listChats(filters);
      return { items: res.items.map(mapChat), total: res.total };
    },
    { keepPreviousData: true },
  );

  const items: ChatboxChatView[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = items.length < total;

  // Опции мессенджеров — из реально встреченных типов в загруженных чатах
  // (+ текущий выбор, чтобы не пропадал при фильтрации). Типы динамические
  // (ChatBox добавляет новые), поэтому строим из данных, а не из фикс-списка.
  const channelTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of items) if (c.channelType) set.add(c.channelType);
    if (channelType) set.add(channelType);
    return [...set].sort();
  }, [items, channelType]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessagesSquare size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Чаты клиентов
            </h1>
            <p className="text-sm text-fg-secondary">
              Переписки из Чат бокса — по всем мессенджерам в одном месте.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1">
          <Link href="/chats/integrations/chatbox">
            <Settings2 size={15} /> Интеграция
          </Link>
        </Button>
      </header>

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="closed">Закрытые</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={channelType || ALL_CHANNELS}
          onValueChange={(v) => setChannelType(v === ALL_CHANNELS ? '' : v)}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Все мессенджеры" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CHANNELS}>Все мессенджеры</SelectItem>
            {channelTypeOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {chatboxChannelTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {humanizeApiError(error, 'Не удалось загрузить чаты')}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-subtle p-10 text-center">
          <p className="text-sm text-fg-secondary">
            Чатов нет — настройте интеграцию с Чат боксом.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/chats/integrations/chatbox">Перейти к интеграции</Link>
          </Button>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => router.push(`/chats/${chat.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-bg-card px-4 py-3 text-left transition-colors hover:bg-bg-subtle"
              >
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${chatboxChannelTypeBadgeClass(
                    chat.channelType,
                  )}`}
                >
                  {chatboxChannelTypeLabel(chat.channelType)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg-primary">
                      {chat.clientName || 'Без имени'}
                    </span>
                    <span className="shrink-0 rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-xs text-fg-secondary">
                      {chatboxChatStatusLabel(chat.status)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-fg-tertiary">
                    Ответственный: {chat.responsibleName ?? '—'}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-fg-secondary">
                    {chat.messageCount} сообщ.
                  </div>
                  <div className="text-xs text-fg-tertiary">
                    {formatDate(chat.lastMessageAt)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" /> Загружаем…
              </>
            ) : (
              'Показать ещё'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
