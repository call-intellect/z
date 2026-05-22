import type { Metadata } from 'next';

import { IdeasListClient } from './IdeasListClient';

export const metadata: Metadata = {
  title: 'Идеи',
};

/**
 * `/ideas` — реестр идей и запросов клиентов компании (SBA β-5).
 *
 * Идеи автоматически собираются Специалистом 3.6 из встреч и документов
 * (signalType ∈ idea / feature_request). Кластеризация смежных идей даёт
 * картину «куда тянет команду» и «что просят клиенты».
 *
 * См. plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md.
 */
export default function IdeasPage() {
  return <IdeasListClient />;
}
