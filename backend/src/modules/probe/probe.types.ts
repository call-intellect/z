import type { DataClass } from '@prisma/client';

export interface ProbeSuggestPayload {
  message?: string;
  suggestedActions?: readonly string[];
  contextBlockId?: string;
  contextCardId?: string;
  contextCardKind?: string;
  contextCardTitle?: string;
  objectName?: string;
  objectKindRu?: string;
  suggestedQuestion?: string;
  dataClass?: DataClass;
  actionUrl?: string;
  contextIds?: readonly string[];
  [key: string]: unknown;
}

export interface ProbeSuggestInput {
  tenantId: string;
  emittedByService: string;
  reason: string;
  payload: ProbeSuggestPayload;
  recipientCandidates: readonly string[];
  priorityHint?: number;
  dataClass?: DataClass;
  notBeforeAt?: Date;
}

export type ProbeSuggestResult =
  | { ok: true; probeEventId: string }
  | {
      dropped:
        | 'dedup'
        | 'rate_limit'
        | 'cold_start'
        | 'low_value'
        | 'policy_silent';
    };

export interface NotificationRespondedPayload {
  tenantId: string;
  notificationId: string;
  recipientUserId: string;
  eventType: string;
  payload: Record<string, unknown>;
  contextBlockId: string | null;
  contextCardId: string | null;
}
