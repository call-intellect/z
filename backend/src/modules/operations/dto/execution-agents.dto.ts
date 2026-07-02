import { z } from 'zod';

export const ChronicBlockersQuerySchema = z
  .object({
    status: z.enum(['new', 'recurring', 'resolved']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

export type ChronicBlockersQuery = z.infer<typeof ChronicBlockersQuerySchema>;

export interface ChronicBlockerDto {
  id: string;
  representativeText: string;
  status: string;
  daysOpen: number;
  businessImpactScore: number;
  firstSeenDateLocal: string;
  lastSeenDateLocal: string;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
  relatedBlockIds: string[];
}

export interface ChronicBlockersListDto {
  items: ChronicBlockerDto[];
}
