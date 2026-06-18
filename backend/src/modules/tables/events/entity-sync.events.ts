export const ENTITY_CREATED = 'entity.created' as const;
export const ENTITY_UPDATED = 'entity.updated' as const;
export const ENTITY_ARCHIVED = 'entity.archived' as const;

export type EntitySyncEventName =
  | typeof ENTITY_CREATED
  | typeof ENTITY_UPDATED
  | typeof ENTITY_ARCHIVED;

export interface EntitySyncEventPayload {
  tenantId: string;
  entityId: string;
  entityType: string;
}

export const MEETING_AI_READY = 'meeting.ai_ready' as const;

export interface MeetingAiReadyEventPayload {
  meetingId: string;
  tenantId: string;
  type: string;
}
