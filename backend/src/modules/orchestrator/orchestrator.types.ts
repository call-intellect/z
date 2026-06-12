/**
 * SBA δ-1 — Orchestrator (multi-agent research).
 *
 * Базовые типы: события SSE, plan, subagent context, synthesis, verification.
 *
 * Стратегии subagent'ов (4 готовых, расширяется отдельным backlog'ом):
 *   - `entity_research`        — собрать всё, что знает граф о конкретной сущности.
 *   - `comparison`             — сравнить N сущностей по K измерениям.
 *   - `topic_summary`          — обобщить, что в компании говорят про тему.
 *   - `timeline_construction`  — построить хронологию событий по теме.
 */

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

/**
 * Шаг плана. Каждый шаг превращается в один subagent-job.
 * `contextSlice` — изолированный slice контекста (НЕ полная история run'а).
 */
export interface OrchestratorPlanStep {
  stepIndex: number;
  agentType: OrchestratorAgentType;
  /** Краткое описание для UI (отображается рядом со spinner'ом). */
  description: string;
  /** Slice контекста, который видит subagent. */
  contextSlice: {
    focus: string;
    /** Дополнительные seed-входы (имена сущностей, ключевые слова, blockId'ы). */
    seedHints?: string[];
    /** Параметры стратегии (например, для comparison — список subjects). */
    params?: Record<string, unknown>;
  };
}

export interface OrchestratorPlan {
  steps: OrchestratorPlanStep[];
  /** Краткое summary плана (1-2 предложения), для UI. */
  rationale: string;
}

/**
 * A9 (I11) — имя JSON Schema strict для `orchestrator-plan`.
 */
export const ORCHESTRATOR_PLAN_SCHEMA_NAME = 'orchestrator_plan_v1' as const;

/**
 * A9 (I11) — JSON Schema strict для `orchestrator-plan` (план шагов
 * multi-agent research). Заменяет прежний `responseFormat: json_object`
 * + «верни строго JSON» — снижает долю битого JSON.
 *
 * Совместимость: OpenAI Responses API (gpt-4o primary) — нативно;
 * DeepSeek (secondary) — прозрачно через tool-путь (deepseek.service.ts);
 * Ollama (tertiary) — бросит `LlmFormatNotSupportedError`, роутер перейдёт
 * к следующему провайдеру (как в `regulation-extract`).
 *
 * Схема выровнена под реальный парс `PlanningService.tryParse`:
 * верхнеуровневые `rationale` + `steps`, у каждого шага `agentType`
 * (enum из whitelist), `description`, `contextSlice` с `focus` +
 * опциональными `seedHints` / `params`. Все объектные узлы strict
 * (additionalProperties:false, required = все ключи properties).
 */
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
                // strict требует, чтобы все ключи properties были в required;
                // опциональность выражаем nullable-типом (subjects/dimensions
                // → null, если стратегия не comparison). Парсер и
                // comparison.strategy фильтруют по Array.isArray — null
                // деградирует в «нет параметров».
                required: ['subjects', 'dimensions'],
                properties: {
                  subjects: {
                    type: ['array', 'null'],
                    items: { type: 'string' },
                    description:
                      'Только для comparison: что сравниваем. null/[] — иначе.',
                  },
                  dimensions: {
                    type: ['array', 'null'],
                    items: { type: 'string' },
                    description:
                      'Только для comparison: измерения сравнения. null/[] — иначе.',
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

/**
 * Результат работы subagent'а. Всегда содержит `text` и optionally
 * `citations[]` (blockId / entityId, на которые опирался ответ).
 */
export interface OrchestratorSubagentResult {
  text: string;
  citations?: Array<{
    type: 'block' | 'entity' | 'meeting' | 'card' | 'document';
    id: string;
    snippet?: string;
  }>;
  /** Самооценка confidence subagent'а (0..1). */
  confidence?: number;
}

export interface OrchestratorSynthesis {
  text: string;
  /** Объединённый список citations поверх всех subagent'ов. */
  citations: Array<{
    type: 'block' | 'entity' | 'meeting' | 'card' | 'document';
    id: string;
    snippet?: string;
  }>;
  /** Список stepIndex, которые попали в финальный ответ. */
  usedSteps: number[];
}

export interface OrchestratorVerification {
  confidence: number;
  reasoning: string;
  retried: boolean;
}

/**
 * SSE event типы. UI рендерит timeline (план → выполнение → синтез →
 * верификация → done).
 */
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

/**
 * Параметры запуска Orchestrator-run.
 *
 * `depth` — hard limit 1 (subagent НЕ может spawn'ить). На случай будущей
 * расширения схема разрешает 1+, но сервис всегда clamp'ает в 1.
 */
export interface OrchestratorRunInput {
  task: string;
  tenantId: string;
  userId: string;
  /** По умолчанию 1; на текущей фазе любой передаваемый > 1 будет clamp'ed. */
  depth?: number;
}

/**
 * Жёсткие лимиты Orchestrator-а (anti-cost-runaway).
 * Значения берутся из process.env с TODO-комментом из-за TS2589 в TypedConfigService.
 */
export interface OrchestratorLimits {
  enabled: boolean;
  maxSubagentsPerRun: number;
  runTimeoutMinutes: number;
}
