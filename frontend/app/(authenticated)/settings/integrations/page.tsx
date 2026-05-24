import type { Metadata } from 'next';

import { DestinationsClient } from './DestinationsClient';
import { TelegramLinkSection } from './TelegramLinkSection';

export const metadata: Metadata = {
  title: 'Интеграции — Z',
};

/**
 * `/settings/integrations` — два логических блока:
 *   1. Личный канал (Telegram-бот через ConversationalModule) — onboarding
 *      link-code wizard + памятка по командам.
 *   2. Outbound-направления (Email/Slack/Telegram-bot/Webhook) для отправки
 *      задач и уведомлений — `DestinationsClient`.
 */
export default function SettingsIntegrationsPage() {
  return (
    <div className="w-full">
      <TelegramLinkSection />
      <DestinationsClient />
    </div>
  );
}
