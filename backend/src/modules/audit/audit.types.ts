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
  REGULATION_DELETE: 'regulation.delete',
  REGULATION_RESTORE: 'regulation.restore',
  TASK_SOLUTION_DELETE: 'task_solution.delete',
  TASK_SOLUTION_RESTORE: 'task_solution.restore',
  DECISION_DELETE: 'decision.delete',
  DECISION_RESTORE: 'decision.restore',
  MEETING_LINK_TO_CARD: 'meeting.link_to_card',
  MEETING_UNLINK_FROM_CARD: 'meeting.unlink_from_card',

  SOURCE_CREATED: 'source.created',
  SOURCE_UPDATED: 'source.updated',
  SOURCE_DELETED: 'source.deleted',
  SOURCE_TESTED: 'source.tested',
  DUMP_CREATED: 'dump.created',
  INGEST_API_KEY_USED: 'ingest_api_key.used',

  BLOCK_CREATED: 'block.created',
  BLOCK_MERGED: 'block.merged',
  BLOCK_ARCHIVED: 'block.archived',
  BLOCK_DELETED_BY_RETENTION: 'block.deleted_by_retention',
  ENTITY_CREATED: 'entity.created',
  ENTITY_MERGED: 'entity.merged',
  LINK_CREATED: 'link.created',
  LINK_REMOVED: 'link.removed',
  THEME_CREATED: 'theme.created',
  THEME_ARCHIVED: 'theme.archived',
  WORKER_FAILED: 'worker.failed',
  ORG_CREATED: 'org.created',
  ORG_UPDATED: 'org.updated',
  MEMBERSHIP_INVITED: 'membership.invited',
  MEMBERSHIP_REMOVED: 'membership.removed',
  MEMBERSHIP_ROLE_CHANGED: 'membership.role_changed',
  PERSON_DATA_ERASED: 'person.data_erased',
  RETENTION_POLICY_UPDATED: 'retention_policy.updated',
  DATA_CLASS_VIOLATION: 'data_class.violation',

  TIER_CHANGED: 'tier.changed',
  ENTITLEMENT_OVERRIDE_SET: 'entitlement.override_set',
} as const;

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
