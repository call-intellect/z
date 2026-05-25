/**
 * Admin-redesign Фаза 7 — DTO для `AdminStorageController`.
 *
 * UI `/admin/media/storage` — снимок S3-стораджа: бакеты + объём + кнопка
 * «переключить провайдера». Реальное переключение S3-эндпоинта — на уровне
 * инфраструктуры (ENV `S3_ENDPOINT_URL`); AdminSetting `storage.provider`
 * лишь маркирует выбор для UI/мониторинга.
 */

import { z } from 'zod';

// ───────────────────────── switch provider ───────────────────────────────

export const SwitchProviderSchema = z.object({
  /**
   * Список провайдеров: yandex / selectel / sbercloud / minio.
   * Хардкод — это глобальный enum в проекте Z (S3-инфра поддерживает только
   * S3-compatible сервисы; см. CLAUDE.md и feedback_switchable_endpoints).
   */
  provider: z.enum(['yandex', 'selectel', 'sbercloud', 'minio']),
  /** Причина переключения. Обязательна, ≥10 символов (severity='destructive'). */
  reason: z.string().trim().min(10).max(1000),
});
export type SwitchProviderDto = z.infer<typeof SwitchProviderSchema>;

// ───────────────────────────── responses ─────────────────────────────────

export interface BucketStatsDto {
  /** Имя бакета. */
  name: string;
  /** S3 endpoint URL. */
  endpoint: string;
  /** Регион (если задан). */
  region: string | null;
  /** Кол-во объектов в бакете (примерное, через ListObjectsV2). */
  objectsCount: number;
  /** Суммарный размер байтов (только посчитанных объектов). */
  bytesTotal: number;
  /** True если объектов >1000 — показатель приблизительный. */
  truncated: boolean;
  /** ok=true если HEAD/LIST прошёл; иначе ok=false + error. */
  ok: boolean;
  error: string | null;
}

export interface StorageStatsResponseDto {
  buckets: BucketStatsDto[];
  /** Сумма objectsCount по всем бакетам (нижняя оценка при truncated). */
  totalObjects: number;
  /** Сумма bytesTotal по всем бакетам. */
  totalBytes: number;
  collectedAt: string;
}

export interface SwitchProviderResponseDto {
  ok: true;
  provider: string;
  appliedAt: string;
}
