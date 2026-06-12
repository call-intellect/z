import type { Metadata } from 'next';

import { SkillTraitConceptsClient } from './SkillTraitConceptsClient';

export const metadata: Metadata = {
  title: 'Смысловые блоки навыка',
};

/**
 * `/admin/skill-trait-concepts` — управление «Смысловыми блоками навыка»
 * (SkillTraitConcept). Канонизация одинаковых по смыслу SkillTrait у разных
 * сотрудников: «осторожен с оценками сроков», «не любит давать сроки без
 * данных», «откладывает оценку» — один концепт.
 *
 * Backend контроллер — `backend/src/modules/admin/skill-trait-concepts/`,
 * RBAC owner/admin Org (per-tenant). См. ТЗ
 * `plans/tz/2026-05-25-clone-reliability-hardening.md`, Фаза 2.
 */
export default function AdminSkillTraitConceptsPage() {
  return <SkillTraitConceptsClient />;
}
