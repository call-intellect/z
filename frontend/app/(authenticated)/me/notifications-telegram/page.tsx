import type { Metadata } from 'next';

import { NotificationsTelegramClient } from './NotificationsTelegramClient';

export const metadata: Metadata = {
  title: 'Уведомления в Telegram',
};

/**
 * `/me/notifications-telegram` — управление тем, что бот шлёт в Telegram
 * лично мне (β-9 / Phase 6, 2026-05-25).
 *
 * Под капотом — `PATCH /api/v1/me/channels/bindings/:bindingId/preferences`
 * с полями `eventTypeAllow` (whitelist) и `quietHours` (строка
 * `HH:mm-HH:mm[|critical]`).
 */
export default function NotificationsTelegramPage() {
  return <NotificationsTelegramClient />;
}
