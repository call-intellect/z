import { z } from 'zod';

const MissionInputSchema = z
  .object({
    contentMd: z.string().trim().min(1).max(8000),
    horizon: z.enum(['operational', 'tactical', 'strategic', 'long_term']).optional(),
    targetDate: z.string().datetime().optional(),
  })
  .strict();

const VisionInputSchema = z
  .object({
    contentMd: z.string().trim().min(1).max(8000),
    horizonYears: z.coerce.number().int().positive().max(50).optional(),
    targetDate: z.string().datetime().optional(),
  })
  .strict();

const StrategyInputSchema = z
  .object({
    contentMd: z.string().trim().min(1).max(8000),
    markets: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    bets: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    horizon: z.enum(['operational', 'tactical', 'strategic', 'long_term']).optional(),
    targetDate: z.string().datetime().optional(),
  })
  .strict();

export const UpdateCompanyProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(300).optional(),
    mission: MissionInputSchema.nullable().optional(),
    vision: VisionInputSchema.nullable().optional(),
    strategy: StrategyInputSchema.nullable().optional(),
    targetMarketIds: z.array(z.string().min(1).max(120)).max(50).optional(),
    stage: z.enum(['early_stage', 'growth', 'scale', 'enterprise']).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateCompanyProfileDto = z.infer<typeof UpdateCompanyProfileSchema>;

export interface CompanyProfileDto {
  id: string;
  tenantId: string;
  displayName: string | null;
  mission: {
    contentMd: string;
    horizon?: string;
    targetDate?: string;
  } | null;
  vision: {
    contentMd: string;
    horizonYears?: number;
    targetDate?: string;
  } | null;
  strategy: {
    contentMd: string;
    markets?: string[];
    bets?: string[];
    horizon?: string;
    targetDate?: string;
  } | null;
  targetMarketIds: string[];
  maturityScore: number | null;
  lastMaturityCalcAt: string | null;
  stage: string | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RebuildCompletenessResponseDto {
  ok: true;
  enqueued: boolean;
  reason: string;
}
