/**
 * Action constants для AuditLog.
 *
 * ВНИМАНИЕ: значения — стабильный контракт. Не переименовывать без миграции
 * существующих записей и обновления админ-фильтров.
 */
export const AUDIT = {
  USER_DELETE: 'user.delete',
  USER_RESTORE: 'user.restore',

  SHARE_CREATE: 'share.create',
  SHARE_REVOKE: 'share.revoke',
  SHARE_EXTEND: 'share.extend',

  API_KEY_CREATE: 'api_key.create',
  API_KEY_DELETE: 'api_key.delete',

  WEBHOOK_SUBSCRIPTION_CREATE: 'webhook_subscription.create',
  WEBHOOK_SUBSCRIPTION_DELETE: 'webhook_subscription.delete',

  DESTINATION_CREATE: 'destination.create',
  DESTINATION_UPDATE: 'destination.update',
  DESTINATION_DELETE: 'destination.delete',

  MEETING_DELETE: 'meeting.delete',
  MEETING_REGENERATE: 'meeting.regenerate',

  EXPORT_CREATE: 'export.create',
  EXPORT_DELETE: 'export.delete',

  QUOTA_EXCEEDED: 'quota.exceeded',

  TASK_SEND: 'task.send',
  TASK_BULK: 'task.bulk',

  CARD_CREATE: 'card.create',
  CARD_UPDATE: 'card.update',
  CARD_DELETE: 'card.delete',
  CARD_RESTORE: 'card.restore',
  MEETING_LINK_TO_CARD: 'meeting.link_to_card',
  MEETING_UNLINK_FROM_CARD: 'meeting.unlink_from_card',

  // ── knowledge-core Фаза 10: источники + ingest ──
  SOURCE_CREATED: 'source.created',
  SOURCE_UPDATED: 'source.updated',
  SOURCE_DELETED: 'source.deleted',
  SOURCE_TESTED: 'source.tested',
  DUMP_CREATED: 'dump.created',
  INGEST_API_KEY_USED: 'ingest_api_key.used',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}
