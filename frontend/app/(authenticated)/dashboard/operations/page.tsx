import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileTeamClient } from '@/ui/mobile/exec/MobileTeamClient';

import { OperationsDashboardClient } from './OperationsDashboardClient';

export const metadata: Metadata = {
  title: 'Операции',
};

/**
 * SBA β-8 — `/dashboard/operations` — COO операционный дашборд.
 *
 * Server-обёртка; данные тянет client через `operationsDashboardApi`. Доступ
 * валидируется на backend через `RbacService.canViewOperationsDashboard`
 * (owner / admin / coo / super_admin). Manager → 403.
 *
 * Мобайл (ТЗ B2/Ф3): ниже md рендерим «Команду» (`MobileTeamClient`) на том же
 * роуте/тех же эндпоинтах. Инвариант №1: десктоп-ветка `MobileShell` дословно
 * `<OperationsDashboardClient />`. `MobileShell` — client-компонент, поэтому
 * передача client-элементов пропсами из server-обёртки допустима.
 */
export default function OperationsDashboardPage() {
  return (
    <MobileShell
      mobile={<MobileTeamClient />}
      desktop={<OperationsDashboardClient />}
    />
  );
}
