import { z } from 'zod';

/**
 * SBA β-8.2 — DTO для эндпоинтов «Хранителя обещаний».
 *
 *   - /me/promises (личный кабинет сотрудника)
 *   - /dashboard/operations/open-commitments (карта обещаний для COO/owner/admin)
 *   - /personal-relations/commitments?personId= (вкладка обещаний на странице человека)
 */

export const COMMITMENT_STATUS_VALUES = [
  'open',
  'asked',
  'fulfilled',
  'missed',
  'cancelled',
  'superseded',
] as const;

export type CommitmentStatus = (typeof COMMITMENT_STATUS_VALUES)[number];

export const ListMyPromisesQuerySchema = z
  .object({
    status: z.enum(['open', 'asked', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type ListMyPromisesQuery = z.infer<typeof ListMyPromisesQuerySchema>;

export const MarkPromiseBodySchema = z
  .object({
    status: z.enum(['fulfilled', 'missed', 'cancelled', 'superseded']),
    note: z.string().max(2_000).optional(),
  })
  .strict();

export type MarkPromiseBody = z.infer<typeof MarkPromiseBodySchema>;

export const OpenCommitmentsQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(180).default(14),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export type OpenCommitmentsQuery = z.infer<typeof OpenCommitmentsQuerySchema>;

export const PersonCommitmentsQuerySchema = z
  .object({
    personId: z.string().min(1).max(80).optional(),
    entityId: z.string().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((d) => d.personId !== undefined || d.entityId !== undefined, {
    message: 'Нужен personId или entityId',
  });

export type PersonCommitmentsQuery = z.infer<
  typeof PersonCommitmentsQuerySchema
>;

export interface CommitmentDto {
  id: string;
  tenantId: string;
  text: string;
  /** Один из CommitmentStatus или null если ещё не классифицирован. */
  status: CommitmentStatus | null;
  dueDate: string | null;
  recipientPersonId: string | null;
  recipientPersonName: string | null;
  /** Имя автора (опц., только в `/open-commitments` и `/personal-relations/commitments`). */
  authorPersonId: string | null;
  authorPersonName: string | null;
  askedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}

export interface OpenCommitmentsListDto {
  items: CommitmentDto[];
  total: number;
}
