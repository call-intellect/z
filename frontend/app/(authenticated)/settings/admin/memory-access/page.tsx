import type { Metadata } from 'next';

import { MemoryAccessClient } from './MemoryAccessClient';

export const metadata: Metadata = {
  title: 'Доступ к памяти компании',
};

/**
 * `/settings/admin/memory-access` (ТЗ 2026-05-26 §6).
 *
 * Owner/admin Org настраивает, какие разделы «Памяти компании» доступны
 * рядовым сотрудникам (роль `member`). По умолчанию закрыты:
 *   - Правила и стандарты
 *   - Сущности
 *
 * Идеи открыты для всех — переключателя нет.
 */
export default function MemoryAccessPage() {
  return <MemoryAccessClient />;
}
