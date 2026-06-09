import type { Metadata } from 'next';

import { BitrixIntegrationClient } from './BitrixIntegrationClient';
import { DestinationsClient } from './DestinationsClient';

export const metadata: Metadata = {
  title: 'Интеграции',
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
    <div className="w-full space-y-6">
      <DestinationsClient />
      <div className="mx-auto w-full max-w-3xl px-4">
        <BitrixIntegrationClient />
      </div>
    </div>
  );
}
