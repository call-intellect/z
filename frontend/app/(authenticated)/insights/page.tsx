import type { Metadata } from 'next';

import { InsightsListClient } from './InsightsListClient';

export const metadata: Metadata = {
  title: 'Сигналы',
};

/**
 * `/insights` — радар повторяющихся сигналов компании (SBA β-4).
 *
 * Сигналы автоматически извлекаются Специалистом 3.5 из встреч и документов
 * (signalType ∈ pain / risk / churn_risk / objection). KNN-кластеризация
 * объединяет похожие сигналы в один Insight с динамикой частоты.
 *
 * Ключевая ценность: компания видит свои повторяющиеся проблемы и риски
 * в реальном времени и реагирует до того, как они станут критическими.
 * См. plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md.
 */
export default function InsightsPage() {
  return <InsightsListClient />;
}
