import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileDealsClient } from '@/ui/mobile/exec/MobileDealsClient';

import { WeekDesktopClient } from './WeekDesktopClient';

export const metadata: Metadata = {
  title: 'Неделя',
};

/**
 * НЕДЕЛЯ — `/week` (ТЗ редизайн кабинета, Ф2).
 *
 * Понедельничный ритм: слияние недельной сводки + операционного пульса +
 * «кто держит слово» в один экран с вкладками (`WeekDesktopClient`). Старые
 * роуты `/dashboard/operations/weekly` и `/dashboard/portfolio` редиректят сюда.
 *
 * Мобайл: ниже md — «Дела» (`MobileDealsClient`), как и прежний роут.
 */
export default function WeekPage() {
  return (
    <MobileShell
      mobile={<MobileDealsClient />}
      desktop={<WeekDesktopClient />}
    />
  );
}
