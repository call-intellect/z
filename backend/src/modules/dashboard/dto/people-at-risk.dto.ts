import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PeopleAtRiskQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3),
});
export class PeopleAtRiskQueryDto extends createZodDto(PeopleAtRiskQuerySchema) {}
export type PeopleAtRiskQuery = z.infer<typeof PeopleAtRiskQuerySchema>;

export const PeopleAtRiskItemSchema = z.object({
  personId: z.string(),
  name: z.string(),
  department: z.string().nullable(),
  pulseScore: z.number().int().min(0).max(100),
  topReason: z.string().min(1),
  engagementScoreAt: z.string().nullable(),
});
export type PeopleAtRiskItem = z.infer<typeof PeopleAtRiskItemSchema>;

export const PeopleAtRiskResponseSchema = z.object({
  items: z.array(PeopleAtRiskItemSchema),
  totalAtRisk: z.number().int().min(0),
  generatedAt: z.string(),
});
export type PeopleAtRiskResponse = z.infer<typeof PeopleAtRiskResponseSchema>;
