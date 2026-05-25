import type { Metadata } from 'next';

import { ExpiringRecordingsTable } from '@/ui/components/admin/ExpiringRecordingsTable';
import { AdminSection } from '@/ui/components/admin/AdminSection';

export const metadata: Metadata = {
  title: 'Истекающие записи — Z-Admin',
};

/**
 * Фаза 7 редизайна — `/admin/media/expiring` (новый URL).
 *
 * Wrapper над существующим `ExpiringRecordingsTable` — переиспользуем
 * клиент один-в-один (выбор окна, список записей с TTL).
 * Старый `/admin/recordings/expiring` редиректит сюда (308).
 *
 * NB: `ExpiringRecordingsTable` рисует свой `<h1>`; единый стиль через
 * AdminSection появится после рефактора таблицы.
 */
export default function AdminMediaExpiringPage() {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Записи и медиа' },
        { label: 'Истекающие записи' },
      ]}
      title="Истекающие записи"
      description="Записи встреч, у которых TTL заканчивается в ближайшем окне. Можно продлить срок хранения вручную или забэкапить запись."
    >
      <ExpiringRecordingsTable />
    </AdminSection>
  );
}
