export type OrchestratorAgentType =
  | 'entity_research'
  | 'comparison'
  | 'topic_summary'
  | 'timeline_construction';

export const ALL_ORCHESTRATOR_AGENT_TYPES: readonly OrchestratorAgentType[] = [
  'entity_research',
  'comparison',
  'topic_summary',
  'timeline_construction',
] as const;

export interface OrchestratorPlanStep {
  stepIndex: number;
  agentType: OrchestratorAgentType;
  description: string;
  contextSlice: {
    focus: string;
    seedHints?: string[];
    params?: Record<string, unknown>;
  };
}

export interface OrchestratorPlan {
  steps: OrchestratorPlanStep[];
  rationale: string;
}

export const ORCHESTRATOR_PLAN_SCHEMA_NAME = 'orchestrator_plan_v1' as const;

export const ORCHESTRATOR_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rationale', 'steps'],
  properties: {
    rationale: {
      type: 'string',
      description: '1-2 предложения, почему такой план.',
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agentType', 'description', 'contextSlice'],
        properties: {
          agentType: {
            type: 'string',
            enum: [...ALL_ORCHESTRATOR_AGENT_TYPES],
          },
          description: { type: 'string', maxLength: 240 },
          contextSlice: {
            type: 'object',
            additionalProperties: false,
            required: ['focus', 'seedHints', 'params'],
            properties: {
              focus: { type: 'string', maxLength: 1_000 },
              seedHints: {
                type: 'array',
                items: { type: 'string', maxLength: 300 },
                description:
                  'Имена сущностей / ключевые слова / blockId-ы (если применимы). Пустой массив, если нет.',
              },
              params: {
                type: 'object',
                additionalProperties: false,
                required: ['subjects', 'dimensions'],
                properties: {
                  subjects: {
                    type: ['array', 'null'],
                    items: { type: 'string' },
                    description: 'Только для comparison: что сравниваем. null/[] — иначе.',
                  },
                  dimensions: {
                    type: ['array', 'null'],
                    items: { type: 'string' },
                    description: 'Только для comparison: измерения сравнения. null/[] — иначе.',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export interface OrchestratorSubagentResult {
  text: string;
  citations?: Array<{
    type: 'block' | 'entity' | 'meeting' | 'card' | 'document';
    id: string;
    snippet?: string;
  }>;
  confidence?: number;
}

export interface OrchestratorSynthesis {
  text: string;
  citations: Array<{
    type: 'block' | 'entity' | 'meeting' | 'card' | 'document';
    id: string;
    snippet?: string;
  }>;
  usedSteps: number[];
}

export interface OrchestratorVerification {
  confidence: number;
  reasoning: string;
  retried: boolean;
}

export type OrchestratorStreamEvent =
  | { type: 'started'; runId: string }
  | { type: 'plan'; plan: OrchestratorPlan }
  | {
      type: 'subagent_started';
      stepIndex: number;
      agentType: OrchestratorAgentType;
      description: string;
    }
  | {
      type: 'subagent_completed';
      stepIndex: number;
      agentType: OrchestratorAgentType;
      ok: boolean;
      preview: string;
    }
  | { type: 'synthesis'; synthesis: OrchestratorSynthesis }
  | { type: 'verification'; verification: OrchestratorVerification }
  | { type: 'done'; runId: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'cancelled' };

export interface OrchestratorRunInput {
  task: string;
  tenantId: string;
  userId: string;
  depth?: number;
}

export interface OrchestratorLimits {
  enabled: boolean;
  maxSubagentsPerRun: number;
  runTimeoutMinutes: number;
}
