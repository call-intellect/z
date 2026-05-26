import type { Metadata } from 'next';

import { EntitiesListClient } from './EntitiesListClient';

export const metadata: Metadata = {
  title: 'Сущности',
};

/**
 * `/entities` (ТЗ 2026-05-26 §3) — реестр всех сущностей, которые AI
 * выделил из встреч и разговоров: компании, люди, проекты, продукты,
 * поставщики, технологии, темы.
 *
 * Доступ:
 *   - manager+ — открыт по умолчанию.
 *   - member — только если admin Org включил
 *     `feature.memory_entities_for_members`. Если нет — 403 от бэка → UI
 *     показывает «Раздел недоступен».
 */
export default function EntitiesPage() {
  return <EntitiesListClient />;
}
