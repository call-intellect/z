'use client';

/**
 * HealthClient — `/admin/health` (admin-redesign Фаза 1).
 *
 * Раскладка через `AdminSection` + `AdminTabs`. Шесть вкладок:
 *   Очереди / БД / Эмбеддинги / Воркеры / S3 / LiveKit.
 *
 * Каждая вкладка fetch'ит свой endpoint. Если бэкенд ещё не реализовал
 * соответствующий маршрут — gracefully показываем `AdminEmpty`.
 */

import {
  Boxes,
  Database,
  DatabaseZap,
  HardDrive,
  ListTree,
  Video,
} from 'lucide-react';

import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';

import { HealthDbTab } from './HealthDbTab';
import { HealthEmbeddingsTab } from './HealthEmbeddingsTab';
import { HealthLivekitTab } from './HealthLivekitTab';
import { HealthQueuesTab } from './HealthQueuesTab';
import { HealthS3Tab } from './HealthS3Tab';
import { HealthWorkersTab } from './HealthWorkersTab';

const TABS: AdminTabDef[] = [
  { value: 'queues', label: 'Очереди', icon: ListTree },
  { value: 'db', label: 'БД', icon: Database },
  { value: 'embeddings', label: 'Эмбеддинги', icon: DatabaseZap },
  { value: 'workers', label: 'Воркеры', icon: Boxes },
  { value: 's3', label: 'S3', icon: HardDrive },
  { value: 'livekit', label: 'LiveKit', icon: Video },
];

export function HealthClient() {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Пульс', href: '/admin' },
        { label: 'Здоровье системы' },
      ]}
      title="Здоровье системы"
      description="Очереди, БД, эмбеддинги, воркеры, S3 и LiveKit — каждая часть инфраструктуры на отдельной вкладке."
    >
      <AdminTabs tabs={TABS} defaultTab="queues">
        {(active) => (
          <>
            {active === 'queues' && <HealthQueuesTab />}
            {active === 'db' && <HealthDbTab />}
            {active === 'embeddings' && <HealthEmbeddingsTab />}
            {active === 'workers' && <HealthWorkersTab />}
            {active === 's3' && <HealthS3Tab />}
            {active === 'livekit' && <HealthLivekitTab />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}
