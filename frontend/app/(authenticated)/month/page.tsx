import type { Metadata } from 'next';

import { ValueRecapDashboardClient } from '../dashboard/value-recap/ValueRecapDashboardClient';

export const metadata: Metadata = {
  title: 'Итоги месяца',
};

/**
 * ИТОГИ МЕСЯЦА — `/month` (ТЗ 2026-06-13 «Редизайн кабинета», Ф0).
 *
 * Витрина владельцу: снятая рутина, доведённые решения, сводка месяца, экспорт
 * слайдов. На Ф0 — каркас поверх готового `ValueRecapDashboardClient` (старый
 * `/dashboard/value-recap` редиректит сюда). Блок «Решения месяца + % доведено»
 * и рендер PDF/PPTX достраиваются в Ф3.
 */
export default function MonthPage() {
  return <ValueRecapDashboardClient />;
}
