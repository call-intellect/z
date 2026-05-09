import { MeetingStatus, MeetingType } from '@prisma/client';
import { z } from 'zod';

/**
 * Query-параметры для `GET /api/v1/meetings`.
 *
 * `page` — 1-индексированный (для пользователя), внутри сервиса конвертируем
 * в `skip = (page - 1) * limit`.
 *
 * Phase 2 standalone-product: расширены параметры:
 *   - `query` — поиск по `title` (ILIKE);
 *   - `dateFrom` / `dateTo` — фильтр по `createdAt` ([gte, lte]);
 *   - `status` / `type` — теперь принимают массив (CSV `?status=a,b` или
 *     повторяющийся параметр `?status=a&status=b`).
 */

/**
 * Парсит CSV или массив строк в массив значений enum.
 * Возвращает undefined если на входе пусто.
 */
function arrayOf<T extends string>(values: readonly T[]) {
  const enumValues = new Set<string>(values);
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const arr = Array.isArray(v) ? v : v.split(',');
      const cleaned = arr
        .map((s) => s.trim())
        .filter((s): s is T => s.length > 0 && enumValues.has(s));
      return cleaned.length > 0 ? (cleaned as T[]) : undefined;
    });
}

const STATUS_VALUES = Object.values(MeetingStatus) as MeetingStatus[];
const TYPE_VALUES = Object.values(MeetingType) as MeetingType[];

export const ListMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().min(1).max(200).optional(),
  dateFrom: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().date().optional()),
  dateTo: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().date().optional()),
  status: arrayOf(STATUS_VALUES),
  type: arrayOf(TYPE_VALUES),
  /** Фильтр по карточке. Используется в журнале при переходе из карточки. */
  cardId: z.string().min(1).max(50).optional(),
});

export type ListMeetingsQuery = z.infer<typeof ListMeetingsQuerySchema>;
