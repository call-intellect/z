import type { ReactNode } from 'react';

import { SettingsSidebar } from './SettingsSidebar';

/**
 * Двухколоночный layout для секции настроек.
 *
 * Левая колонка — навигация по подразделам (Профиль / Безопасность /
 * Внешний вид / Теги / Интеграции / API ключи / Webhooks / Экспорты).
 * Правая — content конкретного раздела.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
