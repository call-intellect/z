import type { Metadata } from 'next';

import { DailyDigestToggle } from '@/ui/settings/DailyDigestToggle';
import { PushSubscriptionToggle } from '@/ui/settings/PushSubscriptionToggle';

export const metadata: Metadata = {
  title: 'Уведомления',
};

export default function NotificationsSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-fg-primary">Уведомления</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Настройте, как Кора уведомляет вас о событиях, упоминаниях и новых задачах.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <PushSubscriptionToggle />
        <DailyDigestToggle />
      </section>

      <p className="text-xs text-fg-tertiary">
        Push-уведомления работают только в браузерах, которые поддерживают Web Push (Chrome, Edge, Firefox).
        В iOS Safari уведомления приходят только после установки Коры как PWA на главный экран.
      </p>
    </div>
  );
}
