import type { Metadata } from 'next';

import { DomainsClient } from './DomainsClient';

export const metadata: Metadata = {
  title: 'Функциональные домены',
};

/**
 * `/domains` — дерево функциональных областей компании (SBA α-9 wave 3).
 *
 * 8 базовых доменов (Маркетинг / Продажи / Разработка / Операции / Customer service /
 * HR / Финансы / Стратегия) + per-industry надстройка через seed-template wizard.
 */
export default function DomainsPage() {
  return <DomainsClient />;
}
