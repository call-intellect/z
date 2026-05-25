/**
 * Доменная модель для `/admin/media/retention` — настройки сроков хранения
 * (записи встреч, журналы, soft-delete grace). Фаза 7 редизайна Z-Admin.
 *
 * Контракт backend: `AdminRetentionController` под префиксом
 * `/api/v1/admin/media/retention`. Защита — `SuperAdminGuard` +
 * `SuperAdminAuditInterceptor` (severity='high' требует `reason`).
 *
 * Источник правды о значениях `type` — таблица `RetentionPolicy`
 * (см. `backend/prisma/schema.prisma`). На фронте поддерживаются
 * 5 известных типов; неизвестные приходят как есть, без локализации label.
 */

// ────────────────────────── ApiDto ──────────────────────────

export type RetentionPolicyApiDto = {
  type: string;
  days: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type RetentionPreviewApiDto = {
  type: string;
  currentDays: number;
  newDays: number;
  /** Сколько объектов будут удалены, если сократить срок. */
  affectedCount: number;
  /** Сэмпл идентификаторов (первые N) — для оператора, чтобы понять impact. */
  sampleIds: string[];
  /** Опциональное человекочитаемое описание. */
  warning: string | null;
};

// ────────────────────────── DomainModel ──────────────────────────

/**
 * Известные типы retention. Используются для локализации label'ов
 * в UI. Сервер может вернуть другой `type` — отрендерим его как есть.
 */
export const RETENTION_TYPE_LABELS: Record<string, string> = {
  meeting_recording: 'Записи встреч',
  share_view: 'Просмотры shared записей',
  api_access_log: 'Журнал API доступа',
  webhook_delivery: 'Доставки webhook',
  soft_delete_grace: 'Срок до полного удаления',
};

export type RetentionPolicyDomain = {
  type: string;
  /** Локализованное имя (из карты выше, либо сам `type`). */
  displayName: string;
  days: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: Date;
};

export type RetentionPreviewDomain = {
  type: string;
  displayName: string;
  currentDays: number;
  newDays: number;
  affectedCount: number;
  sampleIds: string[];
  warning: string | null;
};

// ────────────────────────── Mappers ──────────────────────────

export function retentionPolicyFromApi(
  api: RetentionPolicyApiDto,
): RetentionPolicyDomain {
  return {
    type: api.type,
    displayName: RETENTION_TYPE_LABELS[api.type] ?? api.type,
    days: api.days,
    description: api.description,
    updatedBy: api.updatedBy,
    updatedAt: new Date(api.updatedAt),
  };
}

export function retentionPreviewFromApi(
  api: RetentionPreviewApiDto,
): RetentionPreviewDomain {
  return {
    type: api.type,
    displayName: RETENTION_TYPE_LABELS[api.type] ?? api.type,
    currentDays: api.currentDays,
    newDays: api.newDays,
    affectedCount: api.affectedCount,
    sampleIds: api.sampleIds,
    warning: api.warning,
  };
}
