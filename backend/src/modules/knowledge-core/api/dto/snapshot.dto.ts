import { z } from 'zod';

import { SIGNAL_TYPE_VALUES } from '../../prompts/block-ingest.prompt';

import type {
  BlockSearchItemDto,
  EntityItemDto,
  EvidenceItemDto,
} from './search.dto';

/**
 * KC-Temporal W1.3 (2026-05-25) — `GET /api/v1/knowledge/snapshot`.
 *
 * Цель — ответ на вопрос «что мы знали про X на дату T» (bi-temporal-срез
 * IdeaBlock + EntityLink). Параметры запроса (query-string):
 *   - `at`             — обязательная дата (ISO8601), на которую делаем срез.
 *   - `entityId`       — опц. фильтр: блоки/связи, в которых упомянута Entity.
 *   - `signalTypes`    — опц. фильтр по типу сигнала. В query передаётся как
 *                        CSV (`signalTypes=insight,decision`) — Zod парсит
 *                        строку в массив.
 *   - `limit`          — 1..500, default 100. Сервис берёт `limit + 1` и
 *                        выставляет `truncated=true` при превышении.
 */
export const SnapshotQueryRawSchema = z.object({
  at: z
    .string()
    .min(1, 'at обязателен')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'at должен быть ISO8601'),
  entityId: z.string().min(1).optional(),
  signalTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const arr = Array.isArray(v)
        ? v.flatMap((s) => s.split(','))
        : v.split(',');
      const trimmed = arr.map((s) => s.trim()).filter((s) => s.length > 0);
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .pipe(
      z
        .array(z.enum(SIGNAL_TYPE_VALUES))
        .max(SIGNAL_TYPE_VALUES.length)
        .optional(),
    ),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type SnapshotQueryDto = z.infer<typeof SnapshotQueryRawSchema>;

/**
 * Параметры, на которых работает `SnapshotService.getSnapshot`. Отличие от
 * `SnapshotQueryDto`: `at` уже распарсен в `Date`, добавлен `tenantId`.
 */
export interface SnapshotServiceArgs {
  tenantId: string;
  at: Date;
  entityId?: string;
  signalTypes?: string[];
  limit: number;
}

/**
 * Один блок снапшота: сам блок + evidence + entities. Совпадает по форме
 * с элементами `/blocks/:id` и `/search`, чтобы UI/клиенты могли
 * переиспользовать рендер.
 */
export interface SnapshotBlockItemDto {
  block: BlockSearchItemDto;
  evidence: EvidenceItemDto[];
  entities: EntityItemDto[];
}

/**
 * Срез графа: EntityLink-рёбра, активные на `asOf`. Поля упрощены — для
 * UI достаточно from/to id + типа связи + временных границ. Полная
 * деталка ребра доступна через `/api/v1/knowledge/entities/:id/links`.
 */
export interface SnapshotEntityLinkDto {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  fromType: string | null;
  toType: string | null;
  relationType: string;
  validFrom: string;
  validUntil: string | null;
}

/**
 * Ответ `GET /api/v1/knowledge/snapshot`.
 *
 * `truncated=true` означает, что блоков/связей реально больше, чем `limit`:
 * сервис обрезает результат до `limit`, но запрашивает `limit + 1`, чтобы
 * детектировать переполнение. Truncation вычисляется отдельно для блоков
 * и для связей — флаг `true`, если хотя бы один из срезов был ограничен.
 */
export interface SnapshotResponseDto {
  asOf: string;
  blocks: SnapshotBlockItemDto[];
  entityLinks: SnapshotEntityLinkDto[];
  truncated: boolean;
  tookMs: number;
}
