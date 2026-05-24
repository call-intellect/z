import { z } from 'zod';

/**
 * Tracker Phase 3 (Sprint 6, 2026-05-24) — DTO для одного элемента ответа
 * `GET /api/v1/tracker/issues/:id/similar`.
 *
 * Сборка на бэке: KNN по pgvector cosine (`embedding <=> $1::vector`).
 * `similarity = 1 - distance` ∈ [0, 1], где 1 = совпадение, 0 = полностью
 * разные. Threshold по умолчанию 0.18 distance (≈ similarity ≥ 0.82).
 *
 * NB: возвращаем ровно те поля, которые нужны UI-карточке («похожие задачи»
 * в правой панели задачи). Полный IssueResponseDto не нужен — экономим
 * трафик и не тянем join'ы assignees/labels.
 */
export const SimilarIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  stateId: z.string().nullable(),
  projectId: z.string(),
  completedAt: z.string().nullable(),
  /** 1 - distance; ∈ [0, 1]. Выше = ближе. */
  similarity: z.number().min(0).max(1),
});

export type SimilarIssueDto = z.infer<typeof SimilarIssueSchema>;
