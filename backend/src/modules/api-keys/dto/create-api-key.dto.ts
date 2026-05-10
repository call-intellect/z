import { ApiKeyScope } from '@prisma/client';
import { z } from 'zod';

/**
 * Тип ключа ApiKey (Фаза 10 knowledge-core).
 *
 *   - 'api'    — Public API (default; создаётся в `/settings/api-keys`).
 *                Префикс `z_`, проверяется `BearerAuthGuard`.
 *   - 'ingest' — per-Org webhook-ingest (внешние адаптеры — telegram, mango,
 *                IMAP-relay). Префикс `zik_`, проверяется `IngestTokenGuard`.
 *
 * Хранится строкой в БД, валидируется здесь.
 */
export const ApiKeyKindSchema = z.enum(['api', 'ingest']);
export type ApiKeyKind = z.infer<typeof ApiKeyKindSchema>;

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.nativeEnum(ApiKeyScope)).min(1).max(2),
  /**
   * Назначение ключа. По умолчанию 'api' — обратная совместимость с
   * существующими интеграциями.
   */
  scope: ApiKeyKindSchema.default('api'),
});

export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;
