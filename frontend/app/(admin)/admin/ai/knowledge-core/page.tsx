import type { Metadata } from 'next';

import { KnowledgeCoreSettingsClient } from './KnowledgeCoreSettingsClient';

export const metadata: Metadata = {
  title: 'Knowledge-Core настройки',
};

/**
 * Фаза 3 редизайна — `/admin/ai/knowledge-core`.
 *
 * UI для ~40 порогов и тюнинг-параметров Knowledge-Core. Каждый параметр —
 * `AdminSetting` (БД-override поверх ENV-fallback). Сохранение через
 * `useAdminSettingEditor` → `POST /admin/settings/:key` с инвалидацией
 * во всех процессах через Redis pub/sub.
 */
export default function AdminAiKnowledgeCorePage() {
  return <KnowledgeCoreSettingsClient />;
}
