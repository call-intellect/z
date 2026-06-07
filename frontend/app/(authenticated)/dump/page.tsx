import type { Metadata } from 'next';

import { DumpClient } from './DumpClient';

export const metadata: Metadata = {
  title: 'Дамп мысли',
};

/**
 * Страница `/dump` (Фаза 10 knowledge-core, Шаг 10).
 *
 * Web-form адаптер ingest'а: пользователь пишет короткую мысль / заметку,
 * она уходит в общий `RawEvent` Org. Адаптер на бэке создаётся lazy при
 * первом сабмите. Квота — 30 дампов в сутки на пользователя (`429
 * quota_exceeded`).
 */
export default function DumpPage() {
  return <DumpClient />;
}
