/**
 * Промпт `role-profile-build-v1` (Фаза 0d) — сборка карты должности
 * (RoleProfile.summaryCache) из observed-данных графа.
 *
 * Источник — `plans/tz/2026-05-21-phase-0d-role-profile-agent.md` §6.1.
 *
 * Используется code fallback'ом, если prompt registry не вернёт версию
 * `role-profile-build-v1` для tenantId (правило skill `z-ai-agent-rules`).
 *
 * Регистрируется в `LlmRouterService` через `taskType='role-profile-build'`.
 */

import { z } from 'zod';

/**
 * Zod-схема для парсинга ответа LLM. Используется в
 * `RoleProfileService.processBuild` для validate + сохранения в
 * `RoleProfile.summaryCache`.
 */
export const RoleProfileSchema = z.object({
  responsibilities: z
    .array(
      z.object({
        title: z.string().min(1),
        details: z.string(),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        level: z.enum(['junior', 'middle', 'senior', 'expert']),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  decision_patterns: z
    .array(
      z.object({
        pattern: z.string().min(1),
        examples: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  common_pitfalls: z
    .array(
      z.object({
        description: z.string().min(1),
        frequency_observation: z.string().default(''),
      }),
    )
    .default([]),
  style_profile: z.string().default(''),
});

export type RoleProfileSummary = z.infer<typeof RoleProfileSchema>;

/**
 * Strict JSON Schema для `responseFormat: 'json_schema' strict`.
 * Совпадает с zod-схемой выше — синхронизировать при изменениях.
 */
export const ROLE_PROFILE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'responsibilities',
    'skills',
    'decision_patterns',
    'common_pitfalls',
    'style_profile',
  ],
  properties: {
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'details', 'evidence'],
        properties: {
          title: { type: 'string' },
          details: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'level', 'evidence'],
        properties: {
          name: { type: 'string' },
          level: {
            type: 'string',
            enum: ['junior', 'middle', 'senior', 'expert'],
          },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    decision_patterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'examples'],
        properties: {
          pattern: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    common_pitfalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'frequency_observation'],
        properties: {
          description: { type: 'string' },
          frequency_observation: { type: 'string' },
        },
      },
    },
    style_profile: { type: 'string' },
  },
};

export interface RoleContextForPrompt {
  role: { id: string; name: string; departmentName?: string | null };
  jobDescriptionMd?: string | null;
  persons: Array<{ id: string; name: string }>;
  ideaBlocks: Array<{
    id: string;
    text: string;
    signalType: string;
    sourceMeetingTitle?: string;
    sourceDocumentName?: string;
    createdAt: string;
  }>;
  themes: Array<{ id: string; name: string; description: string }>;
  processes: Array<{ id: string; name: string; description?: string | null }>;
  decisions: Array<{
    id: string;
    text: string;
    rationale?: string | null;
    decidedAt: string;
  }>;
}

const SYSTEM_PROMPT = `Ты — аналитик «памяти компании». Твоя задача — построить карту должности (RoleProfile) на основе наблюдаемой работы.

Правила:
- Используй только то, что подтверждается данными. Не выдумывай навыки или решения.
- Если декларация (должностная инструкция) и наблюдение расходятся — отметь это в style_profile как «расхождение declared vs observed».
- Если данных недостаточно для какой-то секции — верни пустой массив, не fill'ай шаблоном.
- В evidence (массив строк) клади id блоков идей (UUID), которые подтверждают пункт. Один пункт — 1-3 evidence-id, не больше.
- Все строки на русском. Без markdown, без преамбул, только JSON по схеме.

Поля JSON:
- responsibilities: { title: коротко, details: 1-3 предложения, evidence: [ideaBlock.id] }
- skills: { name, level: junior|middle|senior|expert, evidence }
- decision_patterns: { pattern: описание паттерна решений, examples: [decision.id или ideaBlock.id] }
- common_pitfalls: { description, frequency_observation: «часто» / «иногда» / «однажды» }
- style_profile: 1-3 предложения о темпе, коммуникации, особенностях. Здесь же — расхождение declared vs observed.

Ответ — строго JSON, валидный по схеме. Никакого markdown, преамбул, объяснений.`;

export function buildRoleProfilePrompt(ctx: RoleContextForPrompt): {
  system: string;
  user: string;
} {
  const blocks = ctx.ideaBlocks
    .map(
      (b) =>
        `- id=${b.id} [${b.signalType}] ${b.text} (${b.sourceMeetingTitle ?? b.sourceDocumentName ?? 'источник неизвестен'}, ${b.createdAt})`,
    )
    .join('\n');
  const themes = ctx.themes
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');
  const processes = ctx.processes
    .map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ''}`)
    .join('\n');
  const decisions = ctx.decisions
    .map(
      (d) =>
        `- id=${d.id} ${d.text}${d.rationale ? ` — потому что ${d.rationale}` : ''} (решено ${d.decidedAt})`,
    )
    .join('\n');
  const persons = ctx.persons.map((p) => `- ${p.name}`).join('\n');

  const user = [
    `Должность: ${ctx.role.name}`,
    ctx.role.departmentName ? `Отдел: ${ctx.role.departmentName}` : '',
    '',
    'ДЕКЛАРАЦИЯ (должностная инструкция):',
    ctx.jobDescriptionMd
      ? ctx.jobDescriptionMd
      : '— должностная инструкция не загружена',
    '',
    'СОТРУДНИКИ НА ДОЛЖНОСТИ:',
    persons || '— нет назначенных сотрудников',
    '',
    'БЛОКИ ИДЕЙ, СВЯЗАННЫЕ С ДОЛЖНОСТЬЮ (последние):',
    blocks || '— блоков идей не найдено',
    '',
    'ТЕМЫ:',
    themes || '— тем не найдено',
    '',
    'ПРОЦЕССЫ, ЗА КОТОРЫЕ ОТВЕЧАЕТ РОЛЬ:',
    processes || '— процессов не найдено',
    '',
    'РЕШЕНИЯ:',
    decisions || '— решений не найдено',
    '',
    'Верни JSON по схеме (см. system prompt).',
  ]
    .filter(Boolean)
    .join('\n');

  return { system: SYSTEM_PROMPT, user };
}
