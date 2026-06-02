import type { Metadata } from 'next';

import { MemoryAccessClient } from './MemoryAccessClient';

export const metadata: Metadata = {
  title: 'Доступ к памяти компании',
};

/**
 * `/company-admin/memory-access` (ТЗ 2026-06-02 — развод «Настройки»/«Админка»).
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
