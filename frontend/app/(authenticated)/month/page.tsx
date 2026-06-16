import type { Metadata } from 'next';
import { Monitor } from 'lucide-react';

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
 *
 * A11.3 — мобильная подсказка: «Итоги месяца» это плотная витрина-отчёт,
 * рассчитанная на большой экран. На узких экранах сверху показываем `md:hidden`
 * баннер с рекомендацией открыть на компьютере. Сам отчёт оставляем ниже —
 * доступ не теряем, только предупреждаем о неоптимальной раскладке.
 */
export default function MonthPage() {
  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-chip-info-bg px-4 py-3 text-chip-info-fg md:hidden">
        <Monitor size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        <p className="text-sm">
          Откройте на компьютере для полного отчёта. «Итоги месяца» — плотная
          витрина с графиками, на телефоне она показывается урезанно.
        </p>
      </div>
      <ValueRecapDashboardClient />
    </>
  );
}
