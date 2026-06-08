import type { Metadata } from 'next';

import { ValueRecapDashboardClient } from './ValueRecapDashboardClient';

export const metadata: Metadata = {
  title: 'Что Кора сделала',
};

/**
 * ТЗ-2 Ф6.C / S1.5 — `/dashboard/value-recap` — месячная витрина «снятой
 * рутины» и слоя «команда лучше».
 *
 * Server-обёртка; данные тянет client через `valueRecapApi`. Доступ
 * валидируется на backend (owner / admin / coo / super_admin).
 */
export default function ValueRecapDashboardPage() {
  return <ValueRecapDashboardClient />;
}
