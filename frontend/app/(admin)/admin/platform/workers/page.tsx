import type { Metadata } from 'next';

import { WorkersClient } from './WorkersClient';

export const metadata: Metadata = {
  title: 'BullMQ воркеры',
};

/**
 * `/admin/platform/workers` — Фаза 8 редизайна Z-Admin.
 *
 * BullMQ inspector: список очередей со счётчиками + панель деталей с
 * failed/completed jobs и кнопками retry / remove.
 */
export default function AdminPlatformWorkersPage() {
  return <WorkersClient />;
}
