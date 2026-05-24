import { z } from 'zod';

/**
 * DTO для `/api/v1/holidays`.
 *
 * `GET /holidays?year=YYYY[&tenantOnly=true]` — список праздников за год.
 * `POST /holidays` — per-tenant override (RBAC: admin/owner).
 *
 * Даты передаём как ISO `YYYY-MM-DD` (date-only). При сохранении нормализуем
 * к UTC-midnight, чтобы избежать TZ-сдвигов.
 */

export const ListHolidaysQuerySchema = z
  .object({
    year: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .default(new Date().getUTCFullYear()),
    /** true — вернуть только per-tenant override (без глобальных). */
    tenantOnly: z.coerce.boolean().default(false),
  })
  .strict();
export type ListHolidaysQuery = z.infer<typeof ListHolidaysQuerySchema>;

export const CreateHolidaySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD'),
    name: z.string().min(1).max(200),
    /** true для перенесённой рабочей субботы. По умолчанию — выходной (false). */
    isWorking: z.boolean().default(false),
  })
  .strict();
export type CreateHolidayDto = z.infer<typeof CreateHolidaySchema>;

export interface HolidayResponseDto {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  name: string;
  isWorking: boolean;
  tenantId: string | null;
}

export interface ListHolidaysResponse {
  items: HolidayResponseDto[];
  year: number;
}
