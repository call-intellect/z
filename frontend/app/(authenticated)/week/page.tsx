import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileDealsClient } from '@/ui/mobile/exec/MobileDealsClient';

import { WeeklyDigestClient } from '../dashboard/operations/weekly/WeeklyDigestClient';

export const metadata: Metadata = {
  title: 'Неделя',
};

/**
 * НЕДЕЛЯ — `/week` (ТЗ 2026-06-13 «Редизайн кабинета», Ф0).
 *
 * Понедельничный ритм: слияние недельной сводки + операционного пульса +
 * портфеля целей. На Ф0 — каркас поверх готового `WeeklyDigestClient`
 * (старый `/dashboard/operations/weekly` теперь редиректит сюда). Полный состав
 * вкладок (Сводка · Пульс сейчас · Кто держит слово) достраивается в Ф2.
 *
 * Мобайл: ниже md — «Дела» (`MobileDealsClient`), как и прежний роут.
 */
export default function WeekPage() {
  return (
    <MobileShell
      mobile={<MobileDealsClient />}
      desktop={<WeeklyDigestClient />}
    />
  );
}
