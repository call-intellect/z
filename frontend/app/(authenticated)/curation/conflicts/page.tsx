import type { Metadata } from 'next';

import { ConflictsListClient } from './ConflictsListClient';

export const metadata: Metadata = {
  title: 'Конфликты курации',
};

/**
 * `/curation/conflicts` — список конфликтов канонизации (SBA, Фаза C3).
 *
 * Конфликты строже очереди курации: доступ только владельцу и администратору
 * Org (плюс super-admin). Слои api/domain/backend переиспользуются как есть.
 */
export default function ConflictsListPage() {
  return <ConflictsListClient />;
}
