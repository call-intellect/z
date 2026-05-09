/**
 * Design-preview маршрут — master-detail журнал встреч.
 *
 * НЕ часть production-flow, НЕ подключена к API. Все данные mock в самом
 * компоненте. Используется для апрува визуала владельцем продукта.
 */
import { MeetingsJournalDesignReference } from '@/ui/components/meetings-journal/MeetingsJournalDesignReference';

export const metadata = {
  title: 'Z · Дизайн-эталон журнала',
};

export default function JournalReferencePage() {
  return <MeetingsJournalDesignReference />;
}
