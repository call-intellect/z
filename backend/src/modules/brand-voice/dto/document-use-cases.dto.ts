import { z } from 'zod';

export const DOCUMENT_USE_CASE_VALUES = [
  'use_in_process',
  'use_for_generation',
  'reference',
  'brand_corpus',
] as const;

export type DocumentUseCase = (typeof DOCUMENT_USE_CASE_VALUES)[number];

export const PatchDocumentUseCasesSchema = z
  .object({
    useCases: z.array(z.enum(DOCUMENT_USE_CASE_VALUES)).max(8),
  })
  .strict();
export type PatchDocumentUseCasesDto = z.infer<typeof PatchDocumentUseCasesSchema>;

export interface PatchDocumentUseCasesResponseDto {
  id: string;
  useCases: string[];
  updatedAt: string;
}
