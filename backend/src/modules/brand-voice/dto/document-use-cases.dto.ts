import { z } from 'zod';

/**
 * SBA β-7 — DTO для `/api/v1/documents/:id/use-cases`.
 *
 * Open enum: значения валидируются на API-уровне, чтобы расширение новыми
 * use-case-метками не требовало миграций. Сейчас известные метки:
 *
 *   - `use_in_process` — документ опорный материал для какого-то процесса.
 *   - `use_for_generation` — шаблон/пример для генерации (контент-производство).
 *   - `reference` — общесправочный документ (дефолт после backfill).
 *   - `brand_corpus` — корпус «голоса бренда» (используется в β-7).
 *
 * Один документ может иметь сразу несколько меток (multi-faceted), поэтому
 * `useCases` — String[]. PATCH перезаписывает массив целиком (а не
 * добавляет/удаляет), это упрощает frontend.
 */

export const DOCUMENT_USE_CASE_VALUES = [
  'use_in_process',
  'use_for_generation',
  'reference',
  'brand_corpus',
] as const;

export type DocumentUseCase = (typeof DOCUMENT_USE_CASE_VALUES)[number];

export const PatchDocumentUseCasesSchema = z
  .object({
    /**
     * Полный набор use-case-меток для документа. Пустой массив допустим,
     * но фронт должен предложить хотя бы 'reference' (нейтральная метка).
     */
    useCases: z.array(z.enum(DOCUMENT_USE_CASE_VALUES)).max(8),
  })
  .strict();
export type PatchDocumentUseCasesDto = z.infer<
  typeof PatchDocumentUseCasesSchema
>;

export interface PatchDocumentUseCasesResponseDto {
  id: string;
  useCases: string[];
  updatedAt: string;
}
