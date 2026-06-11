'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Send } from 'lucide-react';

import { listMyChannels } from '@/api/conversational.api';
import {
  mapTelegramChannelEntry,
  type TelegramChannelStatus,
} from '@/domain/me-channels';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * Ф2 (2026-06-05) — карточка «Telegram» на странице «Я» (`/me`).
 *
 * Read-only статус привязки Telegram + переход на `/me/channels`, где живёт
 * мастер привязки. Здесь НЕТ кода/deep-link — только бейдж статуса и CTA.
 * Статус берётся из общего SWR-ключа `['me-channels', orgId]` (тот же, что
 * переиспользует баннер Ф4) через `mapTelegramChannelEntry`.
 *
 * Ф3 редизайна (2026-06-09) — современный визуальный язык: стеклянная карточка
 * `GlassCard` вместо shadcn `Card`. Якорь `id="me-card-telegram"` сохранён через
 * обёртку-div (GlassCard не пробрасывает `id`).
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
    <div id="me-card-telegram" className="mb-6 scroll-mt-24">
      <GlassCard>
        <CardTitle icon={<Send size={16} />} grad={GRAD.blue}>
          Telegram
        </CardTitle>
        <div className="mt-4">
          {swr.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : swr.error ? (
            <p className="text-sm" style={{ color: CHART.faint }}>
              Статус Telegram недоступен. Попробуйте позже.
            </p>
          ) : (
            <TelegramStatus status={swr.data?.status ?? 'not_linked'} />
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function TelegramStatus({ status }: { status: TelegramChannelStatus }) {
  const linked = status === 'linked';
  const notConfigured = status === 'channel_not_configured';

  // Цвет плашки статуса в палитре современного языка (mint/amber/red/dim).
  const badgeColor =
    status === 'linked'
      ? CHART.mint
      : status === 'bot_blocked'
        ? CHART.amber
        : status === 'channel_disabled'
          ? CHART.red
          : CHART.dim;

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
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-medium"
          style={{ color: badgeColor, background: 'oklch(1 0 0 / 0.06)' }}
        >
          {badgeLabel}
        </span>
        <p className="text-sm" style={{ color: CHART.dim }}>
          {hint}
        </p>
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
