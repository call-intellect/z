import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * DTO эндпоинта `GET /api/v1/dashboard/people-at-risk?limit=N`.
 *
 * ТЗ-G Фаза 1 — серверное ранжирование «Сотрудники под риском» для главной
 * директора. Считает `pulseScore` (0..100) per employee из engagementScore,
 * просроченных обещаний (commitment reliability `overdue` за 14 дней) и доли
 * «красных» чек-инов за 30 дней; возвращает топ-N под порогом риска.
 *
 * Все пороги — `AdminSetting` (через `TypedConfigService.getDynamic`), без
 * финансов. Источник правды о реализации — `PeopleAtRiskService`.
 */

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
