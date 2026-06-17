import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const CheckinDisciplineQuerySchema = z
  .object({
    from: z.string().regex(DATE_RE).optional(),
    to: z.string().regex(DATE_RE).optional(),
  })
  .strict();
export type CheckinDisciplineQuery = z.infer<typeof CheckinDisciplineQuerySchema>;

export interface CheckinDisciplineTotalsDto {
  morningExpected: number;
  morningCompleted: number;
  morningMissed: number;
  eveningExpected: number;
  eveningCompleted: number;
  eveningMissed: number;
  completionRate: number | null;
}

export interface CheckinDisciplinePersonDto extends CheckinDisciplineTotalsDto {
  personId: string;
  personName: string;
}

export interface CheckinDisciplineDto {
  from: string;
  to: string;
  enabled: boolean;
  totals: CheckinDisciplineTotalsDto;
  byPerson: CheckinDisciplinePersonDto[];
}
