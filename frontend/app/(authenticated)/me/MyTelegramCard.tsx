'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Send } from 'lucide-react';

import { listMyChannels } from '@/api/conversational.api';
import {
  mapTelegramChannelEntry,
  type TelegramChannelStatus,
} from '@/domain/me-channels';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Ф2 (2026-06-05) — карточка «Telegram» на странице «Я» (`/me`).
 *
 * Read-only статус привязки Telegram + переход на `/me/channels`, где живёт
 * мастер привязки. Здесь НЕТ кода/deep-link — только бейдж статуса и CTA.
 * Статус берётся из общего SWR-ключа `['me-channels', orgId]` (тот же, что
 * переиспользует баннер Ф4) через `mapTelegramChannelEntry`.
 */
export function MyTelegramCard({ orgId }: { orgId: string }) {
  const swr = useSWR(['me-channels', orgId], async () => {
    const res = await listMyChannels(orgId);
    for (const entry of res.items) {
      const view = mapTelegramChannelEntry(entry);
      if (view) return view;
    }
    // Telegram-канал в этой Org не настроен — считаем «не подключён».
    return null;
  });

  return (
    <Card id="me-card-telegram" className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Send size={16} /> Telegram
        </CardTitle>
      </CardHeader>
      <CardContent>
        {swr.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : swr.error ? (
          <p className="text-sm text-fg-tertiary">
            Статус Telegram недоступен. Попробуйте позже.
          </p>
        ) : (
          <TelegramStatus status={swr.data?.status ?? 'not_linked'} />
        )}
      </CardContent>
    </Card>
  );
}

function TelegramStatus({ status }: { status: TelegramChannelStatus }) {
  const linked = status === 'linked';
  const notConfigured = status === 'channel_not_configured';

  const badgeVariant: 'success' | 'secondary' | 'warning' | 'danger' =
    status === 'linked'
      ? 'success'
      : status === 'bot_blocked'
        ? 'warning'
        : status === 'channel_disabled'
          ? 'danger'
          : 'secondary';

  const badgeLabel =
    status === 'linked'
      ? 'Подключён'
      : status === 'bot_blocked'
        ? 'Бот заблокирован'
        : status === 'channel_disabled'
          ? 'Канал выключен'
          : status === 'channel_not_configured'
            ? 'Не настроен'
            : 'Не подключён';

  const hint = linked
    ? 'Кора может присылать вам задачи, короткие вопросы и упоминания в Telegram.'
    : status === 'bot_blocked'
      ? 'Похоже, бот заблокирован у вас в Telegram. Уведомления туда не доходят.'
      : status === 'channel_disabled'
        ? 'Канал Telegram временно выключен главным администратором Коры.'
        : status === 'channel_not_configured'
          ? 'Telegram пока не настроен администратором компании. Подключение станет доступно, когда будет задан бот.'
          : 'Подключите Telegram, чтобы получать задачи, короткие вопросы и упоминания.';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        <p className="text-sm text-fg-secondary">{hint}</p>
      </div>
      {!notConfigured && (
        <Button asChild variant={linked ? 'outline' : 'default'} size="sm">
          <Link href="/me/channels">
            {linked ? 'Управлять' : 'Подключить Telegram'}
          </Link>
        </Button>
      )}
    </div>
  );
}
