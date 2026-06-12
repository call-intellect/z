import type { Metadata } from 'next';

import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileDealsClient } from '@/ui/mobile/exec/MobileDealsClient';

import { WeeklyDigestClient } from './WeeklyDigestClient';

export const metadata: Metadata = {
  title: 'Недельная сводка',
};

/**
 * SBA β-8.1 — `/dashboard/operations/weekly` — недельная сводка
 * операционного директора.
 *
 * Server-обёртка; данные тянет client через `weeklyDigestApi`. Доступ —
 * coo / owner / admin / super_admin.
 *
 * Мобайл (ТЗ B2/Ф3): ниже md рендерим «Дела» (`MobileDealsClient`) на том же
 * роуте/тех же эндпоинтах. Инвариант №1: десктоп-ветка дословно
 * `<WeeklyDigestClient />`.
 */
export default function WeeklyOperationsDigestPage() {
  return (
    <MobileShell
      mobile={<MobileDealsClient />}
      desktop={<WeeklyDigestClient />}
    />
  );
}
