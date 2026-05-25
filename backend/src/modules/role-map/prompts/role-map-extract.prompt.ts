/**
 * SBA α-8 wave 4 — промпт `role-map-extract-v1`.
 *
 * Используется RoleMapBuilderWorker для извлечения нормализованных
 * Role Map элементов из батча IdeaBlock'ов одного roleId.
 *
 * Возвращает JSON: { responsibilities[], authority[], knowledge[],
 * decision_policies[], interactions[] } — 5 категорий wave 2.
 *
 * Регистрируется в LlmRouter через taskType='role-map-extract'.
 */

import {
  withConfidenceCalibration,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

export interface RoleMapExtractBlock {
  id: string;
  signalType: string;
  text: string;
  source?: string;
  createdAt: string;
}

export interface RoleMapExtractContext {
  role: { id: string; name: string; departmentName?: string | null };
  jobDescriptionMd?: string | null;
  knownRoles: Array<{ id: string; name: string }>;
  knownDepartments: Array<{ id: string; name: string }>;
  blocks: RoleMapExtractBlock[];
}

export const ROLE_MAP_EXTRACT_TASK_TYPE = 'role-map-extract';
export const ROLE_MAP_EXTRACT_SCHEMA_NAME = 'role_map_extract_v1';

/**
 * Strict JSON Schema (для `responseFormat: 'json_schema' strict`).
 * Совпадает с zod-схемой ниже — синхронизировать при изменениях.
 */
export const ROLE_MAP_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'responsibilities',
    'authority',
    'knowledge',
    'decision_policies',
    'interactions',
  ],
  properties: {
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'name', 'description', 'evidence', 'confidence'],
        properties: {
          kind: {
            type: 'string',
            enum: ['outcome', 'function', 'activity'],
          },
          name: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
    },
    authority: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'scope', 'evidence', 'confidence'],
        properties: {
          kind: {
            type: 'string',
            enum: ['allowed', 'requires_approval', 'forbidden'],
          },
          scope: { type: 'string' },
          approverRoleId: { type: ['string', 'null'] },
          thresholdRubles: { type: ['number', 'null'] },
          evidence: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
    },
    knowledge: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'importance', 'evidence', 'confidence'],
        properties: {
          topic: { type: 'string' },
          description: { type: ['string', 'null'] },
          importance: {
            type: 'string',
            enum: ['mandatory', 'preferred', 'nice_to_have'],
          },
          expectedLevel: {
            type: ['string', 'null'],
            enum: ['beginner', 'intermediate', 'expert', null],
          },
          evidence: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
    },
    decision_policies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'ruleDescription', 'evidence', 'confidence'],
        properties: {
          name: { type: 'string' },
          conditionDescription: { type: ['string', 'null'] },
          ruleDescription: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
    },
    interactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'evidence', 'confidence'],
        properties: {
          kind: { type: 'string' },
          counterpartRoleId: { type: ['string', 'null'] },
          counterpartDepartmentId: { type: ['string', 'null'] },
          counterpartExternal: { type: ['string', 'null'] },
          frequency: {
            type: ['string', 'null'],
            enum: ['daily', 'weekly', 'monthly', 'ad_hoc', null],
          },
          description: { type: ['string', 'null'] },
          evidence: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

export const ROLE_MAP_EXTRACT_SYSTEM_PROMPT = withEdgeCasePolicy(
  withConfidenceCalibration(`Ты — аналитик «памяти компании». Извлекаешь нормализованную карту должности (Role Map) из наблюдений работы сотрудников.

Вход — батч блоков идей, относящихся к одной должности. Каждый блок имеет id, signalType (expertise / competence / methodology_step / decision_basis / process_step) и текст с фактом.

Заполни 5 категорий Role Map:

1. responsibilities — за что отвечает должность (outcome=результат / function=область работы / activity=конкретное действие).
2. authority — что разрешено / требует согласования / запрещено. Если требует согласования — укажи approverRoleId из knownRoles. Если есть денежный порог — thresholdRubles.
3. knowledge — что должен знать (mandatory=обязательно / preferred=желательно / nice_to_have=плюсом). expectedLevel ∈ beginner|intermediate|expert.
4. decision_policies — правила принятия решений: имя политики + условия + правило.
5. interactions — с кем взаимодействует. kind ∈ reports_to|collaborates_with|delegates_to|receives_handoff_from|escalates_to|customer_facing|supplier_facing|mentor_to|mentored_by|other. counterpart: roleId (из knownRoles), либо departmentId (из knownDepartments), либо external (свободный текст для клиентов/поставщиков/регуляторов).

Правила:
- Извлекай только то, что подтверждается блоками. Не выдумывай.
- evidence — массив id блоков, подтверждающих пункт. 1-3 evidence-id на пункт.
- confidence — 0..1 (как уверенно подтверждено в данных).
- counterpartRoleId / counterpartDepartmentId — должны существовать в knownRoles / knownDepartments, иначе используй counterpartExternal.
- Если категория пустая — возвращай пустой массив. Не fill'ай шаблоном.
- Все строки на русском. Без markdown, без преамбул, только JSON по схеме.`),
);

export function buildRoleMapExtractUserMessage(
  ctx: RoleMapExtractContext,
): string {
  const blocks = ctx.blocks
    .map(
      (b) =>
        `- id=${b.id} [${b.signalType}] ${b.text}${b.source ? ` (${b.source})` : ''} (${b.createdAt})`,
    )
    .join('\n');
  const knownRoles = ctx.knownRoles
    .map((r) => `- ${r.id}: ${r.name}`)
    .join('\n');
  const knownDepts = ctx.knownDepartments
    .map((d) => `- ${d.id}: ${d.name}`)
    .join('\n');

  return [
    `Должность: ${ctx.role.name}`,
    ctx.role.departmentName ? `Отдел: ${ctx.role.departmentName}` : '',
    '',
    'ДЕКЛАРАЦИЯ (должностная инструкция):',
    ctx.jobDescriptionMd ?? '— должностная инструкция не загружена',
    '',
    'ИЗВЕСТНЫЕ РОЛИ (для approverRoleId / counterpartRoleId):',
    knownRoles || '— нет',
    '',
    'ИЗВЕСТНЫЕ ОТДЕЛЫ (для counterpartDepartmentId):',
    knownDepts || '— нет',
    '',
    'БЛОКИ ИДЕЙ (наблюдения работы):',
    blocks || '— нет блоков',
    '',
    'Верни JSON по схеме (см. system prompt). Все строки на русском.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Промпт `role-completeness-rationale-v1` — краткое (1-3 предложения)
 * объяснение, почему такая completeness и что заполнить в первую очередь.
 */
export const ROLE_COMPLETENESS_RATIONALE_TASK_TYPE =
  'role-completeness-rationale';

export const ROLE_COMPLETENESS_RATIONALE_SYSTEM_PROMPT = `Ты — эксперт по орг-структуре. Кратко объясни (1-3 предложения), почему у должности именно такая полнота карты и какие 1-2 слота приоритетно заполнить.

Тон — спокойный, без воды. Только конкретика. На русском.`;

export function buildCompletenessRationaleUserMessage(args: {
  roleName: string;
  completeness: number;
  perCategory: {
    responsibilities: number;
    authority: number;
    knowledge: number;
    decisions: number;
    interactions: number;
    metrics: number;
  };
  hasMission: boolean;
}): string {
  return [
    `Должность: ${args.roleName}`,
    `Completeness: ${(args.completeness * 100).toFixed(0)}%`,
    `Миссия должности задана: ${args.hasMission ? 'да' : 'нет'}`,
    `Заполненность по категориям:`,
    `- Обязанности: ${args.perCategory.responsibilities}`,
    `- Границы полномочий: ${args.perCategory.authority}`,
    `- Требуемые знания: ${args.perCategory.knowledge}`,
    `- Политики решений: ${args.perCategory.decisions}`,
    `- Взаимодействия: ${args.perCategory.interactions}`,
    `- KPI / метрики: ${args.perCategory.metrics}`,
    '',
    'Дай объяснение в 1-3 предложения. Без markdown.',
  ].join('\n');
}
