import type { Metadata } from 'next';

import { DepartmentsClient } from './DepartmentsClient';

export const metadata: Metadata = {
  title: 'Отделы',
};

/**
 * `/departments` — список отделов компании с детализацией по
 * привязанным FunctionalDomain'ам (SBA α-9 wave 3).
 *
 * Дополнение к /structure: там — общий каркас Org/Dep/Role/Person; здесь —
 * фокус на отделах и их функциональной нагрузке (через DepartmentDomainLink).
 */
export default function DepartmentsPage() {
  return <DepartmentsClient />;
}
