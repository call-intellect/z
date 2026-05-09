import type { ReactNode } from 'react';

/**
 * Layout группы `(design-preview)` — без AppShell, без авторизации.
 * Используется для калибровочных дизайн-эталонов на моках.
 * Маршруты:
 *   - /journal-reference — master-detail журнал встреч
 *   - /meeting-reference — страница результата встречи (3 колонки)
 */
export default function DesignPreviewLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-bg-base text-fg-primary">{children}</div>;
}
