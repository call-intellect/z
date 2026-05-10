import { DataClass, SourceType } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO модуля Sources (Фаза 10 knowledge-core).
 *
 * `config` — `Json | null` в Prisma. Конкретные адаптеры валидируют свою часть
 * `config`-а сами через свои схемы (`telegram-config.schema.ts`,
 * `mango-config.schema.ts`, `imap-config.schema.ts`). Здесь — слабая
 * валидация: object|null + (опционально) `subtype`.
 *
 * Жёсткий парсинг внутреннего объекта `config` происходит в `SourcesService`
 * по полю `type` (см. `validateConfigByType`).
 */

const TypeSchema = z.nativeEnum(SourceType);
const DataClassSchema = z.nativeEnum(DataClass);
const ConfigSchema = z.record(z.string(), z.unknown()).nullable();

export const SourceCreateSchema = z.object({
  type: TypeSchema,
  name: z.string().trim().min(1).max(200),
  config: ConfigSchema.optional(),
  dataClass: DataClassSchema.optional(),
});
export type SourceCreateDto = z.infer<typeof SourceCreateSchema>;

export const SourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  config: ConfigSchema.optional(),
  dataClass: DataClassSchema.optional(),
  isActive: z.boolean().optional(),
});
export type SourceUpdateDto = z.infer<typeof SourceUpdateSchema>;

export const SourceListQuerySchema = z.object({
  type: TypeSchema.optional(),
});
export type SourceListQuery = z.infer<typeof SourceListQuerySchema>;

/**
 * Сериализованный Source для UI (без plain-секретов из config: `botToken`,
 * `passwordEnc` и т.п. отдаются как `<encrypted>`/`<set>`).
 */
export interface SourceResponseDto {
  id: string;
  tenantId: string;
  type: SourceType;
  name: string;
  /** Урезанный config: секреты заменены на маркеры. */
  config: Record<string, unknown> | null;
  dataClass: DataClass;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Информативный URL вебхука для адаптеров с входящим webhook'ом (telegram, mango). */
  webhookUrl?: string;
  /** Время последнего полученного события (RawEvent.receivedAt). */
  lastEventAt?: string | null;
}

export interface SourceListResponseDto {
  items: SourceResponseDto[];
  total: number;
}

export interface SourceTestResultDto {
  ok: boolean;
  details?: Record<string, unknown>;
  errorMessage?: string;
}
