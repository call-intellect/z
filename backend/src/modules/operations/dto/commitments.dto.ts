import { z } from 'zod';

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

export const ReschedulePromiseBodySchema = z
  .object({
    dueDate: z.string().datetime({ offset: true }),
    note: z.string().max(2_000).optional(),
  })
  .strict();

export type ReschedulePromiseBody = z.infer<typeof ReschedulePromiseBodySchema>;

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

export type PersonCommitmentsQuery = z.infer<typeof PersonCommitmentsQuerySchema>;

export interface CommitmentDto {
  id: string;
  tenantId: string;
  text: string;
  status: CommitmentStatus | null;
  dueDate: string | null;
  recipientPersonId: string | null;
  recipientPersonName: string | null;
  authorPersonId: string | null;
  authorPersonName: string | null;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  askedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}

export interface OpenCommitmentsListDto {
  items: CommitmentDto[];
  total: number;
}

export interface OpenQuestionDto {
  id: string;
  text: string;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  reason: string;
  createdAt: string;
}

export interface MyPromisesListDto {
  items: CommitmentDto[];
  openQuestions: OpenQuestionDto[];
}
