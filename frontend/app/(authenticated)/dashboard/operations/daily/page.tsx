import type { Metadata } from 'next';

import { DailyDigestClient } from './DailyDigestClient';

export const metadata: Metadata = {
  title: 'Ежедневный отчёт',
};

/**
 * SBA β-8.3 Wave 1 — `/dashboard/operations/daily` — ежедневный отчёт COO
 * (зеркало `/dashboard/operations/weekly`, окно один день в МСК).
 *
 * Server-обёртка; данные тянет клиент через `operationsDailyDigestApi`.
 * Доступ — coo / owner / admin / super_admin.
 */
export default function DailyOperationsDigestPage() {
  return <DailyDigestClient />;
}
