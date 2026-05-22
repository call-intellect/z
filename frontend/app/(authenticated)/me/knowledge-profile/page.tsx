import type { Metadata } from 'next';

import { KnowledgeProfileClient } from './KnowledgeProfileClient';

export const metadata: Metadata = {
  title: 'Что Кора знает обо мне — Кора',
};

/**
 * `/me/knowledge-profile` (SBA β-2) — «Профиль знаний» сотрудника.
 *
 * Read-only список областей экспертизы (categories) с уровнем уверенности,
 * числом наблюдений и цитатами. Носитель может пометить категорию неверной
 * → создаётся CurationItem deep review.
 *
 * Кнопка «Попробовать своего клона» — disabled до γ-1.
 */
export default function MeKnowledgeProfilePage() {
  return <KnowledgeProfileClient />;
}
