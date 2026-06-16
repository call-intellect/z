import type { DataClass } from '@prisma/client';

export type DerivedKind =
  | 'idea_block'
  | 'insight'
  | 'decision'
  | 'card_rollup'
  | 'executable_persona'
  | 'skill_profile'
  | 'skill_trait'
  | 'idea'
  | 'regulation'
  | 'process'
  | 'policy'
  | 'chat_context'
  | 'ai_usage_log'
  | 'conflict_item'
  | 'probe_event';

export type DataClassSource = {
  dataClass: DataClass;
  subjectPersonId?: string | null;
  sourceId: string;
  sourceKind:
    | 'idea_block'
    | 'decision'
    | 'insight'
    | 'card'
    | 'entity'
    | 'skill_trait'
    | 'idea'
    | 'regulation'
    | 'process'
    | 'chat_message'
    | 'other';
};

export type DataClassAudit = {
  sourceIds: string[];
  sourceKind: string;
  inputClasses: DataClass[];
  floorApplied: DataClass;
  rule:
    | 'max-and-floor'
    | 'private-aggregation-to-sensitive'
    | 'explicit-floor'
    | 'single-source-passthrough';
  result: DataClass;
  resultSubjectPersonId: string | null;
  derivedAt: string;
  policyVersion: string;
};

export type SinkConfig =
  | {
      kind: 'channel_binding';
      maxDataClass: DataClass;
      channel?: string;
      recipientUserId?: string;
      recipientPersonId?: string | null;
      recipientIsOwnerOrSuper?: boolean;
    }
  | {
      kind: 'issue_webhook';
      allowedDataClasses: DataClass[];
      channel?: string;
    }
  | {
      kind: 'export';
      ownerOnly: boolean;
      channel?: string;
    }
  | {
      kind: 'public_api';
      channel?: string;
    }
  | {
      maxDataClass: DataClass;
      channel?: string;
      kind?: undefined;
    };
