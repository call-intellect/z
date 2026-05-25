import type { Metadata } from 'next';

import { DataClassPolicyClient } from './DataClassPolicyClient';

export const metadata: Metadata = {
  title: 'Политика DataClass — Z-Admin',
};

/**
 * `/admin/policy/dataclass` — W4.3 KC-Temporal (2026-05-25).
 *
 * Owner / super_admin: просмотр и редактирование правил выбора DataClass
 * для производных проекций (insight/decision/...), потолков чувствительности
 * по типу канала, и истории нарушений outbound gating'а.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md
 * §4 «Глобальные определения волны» + §W4.3 «UI /admin/policy/dataclass».
 */
export default function AdminPolicyDataClassPage() {
  return <DataClassPolicyClient />;
}
