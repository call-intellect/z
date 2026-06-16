import type { Metadata } from 'next';

import { BitrixManagersClient } from './BitrixManagersClient';

export const metadata: Metadata = {
  title: 'Bitrix24: сопоставление сотрудников',
};

/**
 * `/company-admin/sources/bitrix/managers` — ручной маппинг сотрудников портала
 * Bitrix24 на людей (Person) Коры. ТЗ 2026-06-17 bitrix24-source-sync, Ф5.
 */
export default function BitrixManagersPage() {
  return <BitrixManagersClient />;
}
