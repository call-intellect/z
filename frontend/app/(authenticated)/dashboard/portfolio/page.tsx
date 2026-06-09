import type { Metadata } from 'next';

import { PortfolioDashboardClient } from './PortfolioDashboardClient';

export const metadata: Metadata = {
  title: 'Портфель целей',
};

/**
 * ТЗ-2 Ф6.A — `/dashboard/portfolio` — здоровье портфеля целей (MoSCoW).
 *
 * Server-обёртка; данные тянет client через `portfolioHealthApi`. Доступ
 * валидируется на backend (owner / admin / coo / super_admin).
 */
export default function PortfolioDashboardPage() {
  return <PortfolioDashboardClient />;
}
