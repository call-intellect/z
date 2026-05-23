import type { Metadata } from 'next';

import { ProcessTemplatesClient } from './ProcessTemplatesClient';

export const metadata: Metadata = {
  title: 'Процессы',
};

/**
 * `/processes` — master-detail для ProcessTemplate (SBA α-7 wave 2).
 *
 * Top-tabs (SBA γ-3): «Локальные» (все шаблоны) и «Сквозные»
 * (cross-functional + friction-tracker).
 *
 * Локальная вкладка:
 *   Левая колонка: список ProcessTemplate (filterable by status / completeness / category / search).
 *   Правая колонка: детальная карточка с 5 tabs (Шаги | Решения | Хэндоффы | Версии | Полнота).
 *
 * Сквозная вкладка:
 *   Левая колонка: список cross-functional шаблонов (отсортированы по score).
 *   Правая колонка: friction-отчёты по выбранному шаблону (резолв из UI).
 */
export default function ProcessesPage() {
  return <ProcessTemplatesClient />;
}
