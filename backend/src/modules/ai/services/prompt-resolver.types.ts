export type PromptResolverTaskType =
  | 'summary'
  | 'tasks'
  | 'chapters'
  | 'follow-up'
  | 'card-rollup'
  | 'meeting-quality-score'
  | 'behavior-refine'
  | 'transcript-clean-refine'
  | 'custom-report';

export type ResolvedPromptSource = 'db_org' | 'db_system' | 'code_fallback';

export interface ResolvedPromptSection {
  key: string;
  title: string;
  instruction: string;
  outputType: string;
  required: boolean;
  maxTokens?: number | null;
}

export interface ResolvedPrompt {
  source: ResolvedPromptSource;
  versionId: string | null;
  experimentGroup?: 'A' | 'B';
  systemPrompt: string;
  toolName: string | null;
  toolDescription?: string;
  sections: ResolvedPromptSection[];
  outputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ResolveForMeetingParams {
  tenantId: string;
  meetingId: string;
  meetingType: string;
  taskType: PromptResolverTaskType;
}
