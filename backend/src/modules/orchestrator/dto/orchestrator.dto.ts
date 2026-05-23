import { z } from 'zod';

/**
 * SBA δ-1 — DTO для модуля orchestrator.
 */

/**
 * POST /api/v1/orchestrator/runs — запустить новый research-run.
 */
export const PostOrchestratorRunBodySchema = z.object({
  task: z.string().trim().min(5).max(4000),
  /** Зарезервировано; на текущей фазе clamp'ается в 1. */
  depth: z.number().int().min(1).max(1).optional(),
});
export type PostOrchestratorRunBodyDto = z.infer<
  typeof PostOrchestratorRunBodySchema
>;
