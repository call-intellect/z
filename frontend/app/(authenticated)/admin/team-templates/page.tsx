import type { Metadata } from 'next';

import { TeamTemplatesClient } from '../../team-templates/TeamTemplatesClient';

export const metadata: Metadata = {
  title: 'Шаблоны команд (админка) — Z',
};

/**
 * `/admin/team-templates` — каталог шаблонов команд (системные + кастомные).
 * Phase 1: read-only, переиспользует TeamTemplatesClient. Создание кастомных
 * шаблонов организации — Sprint 9.
 */
export default function AdminTeamTemplatesPage() {
  return <TeamTemplatesClient />;
}
