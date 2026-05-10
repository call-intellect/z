import type { DataClass } from '@prisma/client';
import { z } from 'zod';

/**
 * Тело POST /api/v1/ingest. Используется внешними адаптерами (telegram/email,
 * Фаза 10). In-process meeting-adapter вызывает `IngestService.ingest`
 * напрямую, минуя DTO.
 */
export const IngestEventSchema = z.object({
  /**
   * tenantId — должен совпадать с `Source.tenantId`. Передаётся внешним
   * адаптером явно (он знает свой tenant из своего ApiKey-онбординга,
   * Фаза 10). На Фазе 1 удобно для внутренних smoke-тестов.
   */
  tenantId: z.string().min(1),
  /** ID Source-сущности (см. модель Prisma `Source`). */
  sourceId: z.string().min(1),
  /**
   * Внешний ID события (например, telegram message_id, email Message-ID).
   * Если null — дедуп по checksum payload.
   */
  sourceExternalId: z.string().min(1).optional(),
  /** ISO-строка момента самого события (не приёма). */
  occurredAt: z.string().datetime({ offset: true }),
  /** Свободный JSON: текст + метаданные (участники, таймкоды, тема и т.п.). */
  payload: z.unknown(),
  /** Класс данных для retention/RBAC. По дефолту — `internal`. */
  dataClass: z
    .enum(['public', 'internal', 'sensitive', 'private'] as [
      DataClass,
      ...DataClass[],
    ])
    .optional(),
});

export type IngestEventDto = z.infer<typeof IngestEventSchema>;
