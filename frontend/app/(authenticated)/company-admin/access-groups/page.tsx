import type { Metadata } from 'next';

import { AccessGroupsClient } from './AccessGroupsClient';

export const metadata: Metadata = {
  title: 'Группы доступа к знаниям',
};

/**
 * `/company-admin/access-groups` (ТЗ 2026-06-06 knowledge-access-groups, Ф7b).
 *
 * Owner/admin Org настраивает доступ к знаниям внутри компании:
 *   - направленная матрица «какие отделы видит выбранный отдел»;
 *   - членство в закрытых группах «Руководство» / «Совет» (и в отделах),
 *     включая ручное добавление человека без должности.
 */
export default function AccessGroupsPage() {
  return <AccessGroupsClient />;
}
