import type { Metadata } from 'next';

import { CronsClient } from './CronsClient';

export const metadata: Metadata = {
  title: 'Расписания @Cron',
};

/**
 * `/admin/platform/crons` — Фаза 8 редизайна Z-Admin.
 *
 * UI для управления всеми `@Cron`-задачами через таблицу `CronSchedule`.
 * Источник правды — `CronManagerService` на бэке. Изменения применяются
 * во всех процессах через Redis-publish `cron.schedule.updated`.
 */
export default function AdminPlatformCronsPage() {
  return <CronsClient />;
}
