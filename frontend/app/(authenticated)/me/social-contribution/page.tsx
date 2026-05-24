import type { Metadata } from 'next';

import { MySocialContributionClient } from './MySocialContributionClient';

export const metadata: Metadata = {
  title: 'Мой вклад в команду — Кора',
};

/**
 * `/me/social-contribution` (Specialist 3.8) — мой профиль социального вклада.
 *
 * - 5 публичных типов trait'ов с счётчиками (неделя/месяц/всё время).
 * - Последние traits с evidence-цитатами (полная прозрачность).
 * - Кнопка «Пометить как ошибку» на каждом trait.
 * - Опт-аут «Не показывать публично».
 * - Предупреждение, что руководитель видит дополнительные сигналы.
 */
export default function MySocialContributionPage() {
  return <MySocialContributionClient />;
}
