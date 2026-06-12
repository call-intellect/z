/**
 * Design-preview маршрут — страница результата встречи (эталон).
 *
 * Используется для апрува визуала владельцем продукта. НЕ часть production-flow,
 * НЕ подключена к API — все данные mock прямо в компоненте.
 *
 * Источник: src/ui/components/meeting-result-v2/__design-reference__/MeetingResultPage.reference.tsx
 */
import { MeetingResultPage } from '@/ui/components/meeting-result-v2/__design-reference__/MeetingResultPage.reference';

export const metadata = {
  title: 'Дизайн-эталон страницы встречи',
};

export default function MeetingReferencePage() {
  return <MeetingResultPage />;
}
