import type { Metadata } from 'next';

import { WeeklyDigestClient } from './WeeklyDigestClient';

export const metadata: Metadata = {
  title: 'Недельная сводка — Z',
};

/**
 * SBA β-8.1 — `/dashboard/operations/weekly` — недельная сводка
 * операционного директора.
 *
 * Server-обёртка; данные тянет client через `weeklyDigestApi`. Доступ —
 * coo / owner / admin / super_admin.
 */
export default function WeeklyOperationsDigestPage() {
  return <WeeklyDigestClient />;
}
