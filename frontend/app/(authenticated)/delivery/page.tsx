import type { Metadata } from 'next';

import { DestinationsClient } from '../settings/integrations/DestinationsClient';

export const metadata: Metadata = {
  title: 'Доставка',
};

/**
 * `/delivery` — outbound-доставка задач и уведомлений из встреч
 * (почта / Telegram / Slack / вебхуки) + импорт из трекеров.
 *
 * Самостоятельный раздел главного меню (НЕ под `/settings/*`): раньше жил на
 * `/settings/integrations` и звался «Интеграции», что путало с подключением
 * источников. Подключение источников (CRM/чаты/Bitrix) — в «Админка компании →
 * Источники» (ТЗ 2026-06-16).
 */
export default function DeliveryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <DestinationsClient />
    </div>
  );
}
