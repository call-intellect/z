import type { Metadata } from 'next';

import { MaintenanceClient } from './MaintenanceClient';

export const metadata: Metadata = {
  title: 'Бэкапы и обслуживание — Z-Admin',
};

/**
 * `/admin/platform/maintenance` — Фаза 8 редизайна Z-Admin.
 *
 * Блоки:
 *   - Бэкапы: статус + кнопка «Запустить бэкап сейчас» (501 → disabled).
 *   - Реиндексация: кнопка «Запустить реиндексацию» (TODO).
 *   - Активные maintenance окна — из SystemMessage type='maintenance'.
 */
export default function AdminPlatformMaintenancePage() {
  return <MaintenanceClient />;
}
