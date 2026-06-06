import type { Metadata } from 'next';

import { DestinationsClient } from './DestinationsClient';

export const metadata: Metadata = {
  title: 'Интеграции — Кора',
};

/**
 * `/settings/integrations` — outbound-направления доставки
 * (Email/Slack/Telegram-bot/Webhook) для отправки задач и уведомлений
 * (`DestinationsClient`).
 *
 * Личная привязка Telegram-бота (link-code wizard) переехала на единую
 * страницу «Каналы» (`/me/channels`) — дубль устранён (ТЗ 2026-06-05).
 * Здесь её больше нет.
 */
export default function SettingsIntegrationsPage() {
  return (
    <div className="w-full">
      <DestinationsClient />
    </div>
  );
}
