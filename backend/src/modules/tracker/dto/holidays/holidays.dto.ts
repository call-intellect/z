import { z } from 'zod';

export const ListHolidaysQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
    tenantOnly: z.coerce.boolean().default(false),
  })
  .strict();
export type ListHolidaysQuery = z.infer<typeof ListHolidaysQuerySchema>;

export const CreateHolidaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD'),
    name: z.string().min(1).max(200),
    isWorking: z.boolean().default(false),
  })
  .strict();
export type CreateHolidayDto = z.infer<typeof CreateHolidaySchema>;

export interface HolidayResponseDto {
  id: string;
  date: string;
  name: string;
  isWorking: boolean;
  tenantId: string | null;
}

export interface ListHolidaysResponse {
  items: HolidayResponseDto[];
  year: number;
}
