import type { Metadata } from 'next';

import { EntityGraphClient } from './EntityGraphClient';

/**
 * `/entities/[id]/graph` — UI «что система знает про X» (G.3 KC-Temporal).
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md
 * раздел «G.3 — UI "что система знает про X" с правкой».
 *
 * Под капотом — `GET /api/v1/knowledge/entities/:id/graph?depth=2` плюс
 * `POST /api/v1/knowledge/entities/:id/mark-wrong` для пометки неверных
 * рёбер / узлов (попадает в LlmPreferenceSample через CurationService).
 */
export const metadata: Metadata = {
  title: 'Карта знаний — что система знает про сущность',
};

export default async function EntityGraphPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntityGraphClient entityId={id} />;
}
