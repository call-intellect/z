import type { Metadata } from 'next';

import { AdminMeetingsTable } from '@/ui/components/admin/AdminMeetingsTable';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { adminRootCrumb } from '@/ui/components/admin/brand';

export const metadata: Metadata = {
  title: 'Все встречи',
};

/**
 * Фаза 7 редизайна — `/admin/media/meetings` (новый URL).
 *
 * Wrapper над существующим `AdminMeetingsTable` — переиспользуем
 * клиент один-в-один (фильтры по status/type/owner + пагинация).
 * Старый `/admin/meetings` редиректит сюда (308).
 *
 * NB: `AdminMeetingsTable` пока сам рисует свой `<h1>` — это эффект
 * миграции; единый стиль через `AdminSection` появится после рефактора
 * таблицы. Сейчас задаём breadcrumbs + описание.
 */
export default function AdminMediaMeetingsPage() {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Записи и медиа' },
        { label: 'Все встречи' },
      ]}
      title="Все встречи"
      description="Глобальный список встреч всех Org с фильтрами по статусу, типу и владельцу. Кликните по строке, чтобы открыть детали и записи."
    >
      <AdminMeetingsTable />
    </AdminSection>
  );
}
