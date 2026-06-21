import { z } from 'zod';

const PlanItemSchema = z.object({
  text: z.string().min(1).max(2_000),
  sourceBlockId: z.string().max(80).optional(),
  priority: z.number().int().min(0).max(5).optional(),
});

const DoneItemSchema = z.object({
  text: z.string().min(1).max(2_000),
  sourceBlockId: z.string().max(80).optional(),
  evidenceLink: z.string().max(2_000).optional(),
});

const BlockerItemSchema = z.object({
  text: z.string().min(1).max(2_000),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  ownerHint: z.string().max(200).optional(),
});

export const CreateCheckInSchema = z
  .object({
    kind: z.enum(['morning', 'evening']),
    dateLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateLocal должен быть YYYY-MM-DD')
      .optional(),
    plans: z.array(PlanItemSchema).max(50).optional(),
    dones: z.array(DoneItemSchema).max(50).optional(),
    blockers: z.array(BlockerItemSchema).max(50).optional(),
    rawText: z.string().max(8_000).optional(),
  })
  .strict();

export type CreateCheckInInput = z.infer<typeof CreateCheckInSchema>;

export const ListCheckInsQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    kind: z.enum(['morning', 'evening']).optional(),
  })
  .strict();

export type ListCheckInsQuery = z.infer<typeof ListCheckInsQuerySchema>;

export const HistoryCheckInsQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(180).default(30),
  })
  .strict();

export type HistoryCheckInsQuery = z.infer<typeof HistoryCheckInsQuerySchema>;

export interface DailyCheckInDto {
  id: string;
  tenantId: string;
  personId: string;
  kind: 'morning' | 'evening';
  dateLocal: string;
  plans: Array<{ text: string; sourceBlockId?: string; priority?: number }>;
  dones: Array<{ text: string; sourceBlockId?: string; evidenceLink?: string }>;
  blockers: Array<{
    text: string;
    severity?: 'low' | 'medium' | 'high';
    ownerHint?: string;
  }>;
  notificationId: string | null;
  parseConfidence: number | null;
  curatorReview: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source:
    | 'cron_prompted'
    | 'self_initiated'
    | 'manual'
    | 'meeting'
    | 'bitrix'
    | 'chatbox'
    | 'email'
    | 'phone_call';
  sentiment?: 'green' | 'yellow' | 'red' | null;
  sentimentRationale?: string | null;
  sentimentVersion?: string | null;
  sentimentDeterminedAt?: string | null;
}

export const SENTIMENT_VISIBLE_ROLES = new Set(['owner', 'admin', 'coo', 'super_admin']);

export function stripSentimentForRole(dto: DailyCheckInDto, role: string | null): DailyCheckInDto {
  if (role && SENTIMENT_VISIBLE_ROLES.has(role)) return dto;
  const { sentiment, sentimentRationale, sentimentVersion, sentimentDeterminedAt, ...rest } = dto;
  void sentiment;
  void sentimentRationale;
  void sentimentVersion;
  void sentimentDeterminedAt;
  return rest as DailyCheckInDto;
}
