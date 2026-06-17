import { z } from 'zod';

export const RoleProfileSchema = z.object({
  responsibilities: z
    .array(
      z.object({
        title: z.string().min(1),
        kind: z.enum(['outcome', 'function', 'activity']).default('function'),
        details: z.string(),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  authority: z
    .array(
      z.object({
        kind: z.enum(['allowed', 'requires_approval', 'forbidden']).default('allowed'),
        scope: z.string().min(1),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  knowledge: z
    .array(
      z.object({
        topic: z.string().min(1),
        importance: z.enum(['mandatory', 'preferred', 'nice_to_have']).default('preferred'),
        expectedLevel: z.enum(['beginner', 'intermediate', 'expert']).nullable().default(null),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  decisions: z
    .array(
      z.object({
        name: z.string().min(1),
        rule: z.string().min(1),
        condition: z.string().default(''),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  interactions: z
    .array(
      z.object({
        kind: z.string().min(1),
        counterpart: z.string().default(''),
        frequency: z.string().default(''),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  metrics: z
    .array(
      z.object({
        name: z.string().min(1),
        unit: z.string().default(''),
        target: z.string().default(''),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  ownership: z
    .array(
      z.object({
        what: z.string().min(1),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  kpi_links: z
    .array(
      z.object({
        company_metric: z.string().min(1),
        contribution: z.string().default(''),
      }),
    )
    .default([]),
  style_profile: z.string().default(''),
  completeness_self_rating: z.coerce.number().min(0).max(1).default(0),
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
});

export type RoleProfileSummary = z.infer<typeof RoleProfileSchema>;

export const ROLE_PROFILE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'responsibilities',
    'authority',
    'knowledge',
    'decisions',
    'interactions',
    'metrics',
    'ownership',
    'kpi_links',
    'style_profile',
    'completeness_self_rating',
    'skills',
    'decision_patterns',
    'common_pitfalls',
  ],
  properties: {
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'details', 'evidence'],
        properties: {
          title: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['outcome', 'function', 'activity'],
          },
          details: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    authority: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'scope', 'evidence'],
        properties: {
          kind: {
            type: 'string',
            enum: ['allowed', 'requires_approval', 'forbidden'],
          },
          scope: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    knowledge: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'importance', 'evidence'],
        properties: {
          topic: { type: 'string' },
          importance: {
            type: 'string',
            enum: ['mandatory', 'preferred', 'nice_to_have'],
          },
          expectedLevel: {
            type: ['string', 'null'],
            enum: ['beginner', 'intermediate', 'expert', null],
          },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'rule', 'condition', 'evidence'],
        properties: {
          name: { type: 'string' },
          rule: { type: 'string' },
          condition: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    interactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'counterpart', 'frequency', 'evidence'],
        properties: {
          kind: { type: 'string' },
          counterpart: { type: 'string' },
          frequency: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'unit', 'target', 'evidence'],
        properties: {
          name: { type: 'string' },
          unit: { type: 'string' },
          target: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    ownership: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'evidence'],
        properties: {
          what: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    kpi_links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company_metric', 'contribution'],
        properties: {
          company_metric: { type: 'string' },
          contribution: { type: 'string' },
        },
      },
    },
    style_profile: { type: 'string' },
    completeness_self_rating: { type: 'number' },
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

const SYSTEM_PROMPT = `Ты — аналитик «памяти компании». Твоя задача — построить карту должности (Role Map, 9 слотов) на основе наблюдаемой работы.

Правила:
- Используй только то, что подтверждается данными. Не выдумывай.
- Если декларация (должностная инструкция) и наблюдение расходятся — отметь это в style_profile как «расхождение declared vs observed».
- Если данных недостаточно для секции — верни пустой массив, не fill'ай шаблоном.
- В evidence (массив строк) клади id блоков идей (UUID), которые подтверждают пункт. 1-3 evidence-id на пункт.
- completeness_self_rating: 0..1, твоя оценка «насколько данных хватило для полноценной карты».
- Все строки на русском. Без markdown, без преамбул, только JSON по схеме.

9 нормализованных слотов:
1. responsibilities: { title, kind: outcome|function|activity, details, evidence }.
   - outcome = результат, function = область работы, activity = действие.
2. authority: { kind: allowed|requires_approval|forbidden, scope, evidence }.
3. knowledge: { topic, importance: mandatory|preferred|nice_to_have, expectedLevel?: beginner|intermediate|expert, evidence }.
4. decisions: { name, rule, condition, evidence } — политики принятия решений.
5. interactions: { kind, counterpart, frequency, evidence } — с кем, как часто (daily/weekly/monthly/ad_hoc).
6. metrics: { name, unit, target, evidence } — KPI и показатели.
7. ownership: { what, evidence } — что в зоне ответственности (compliance / ресурсы).
8. kpi_links: { company_metric, contribution } — на какие метрики компании влияет.
9. style_profile: 1-3 предложения о темпе/коммуникации + completeness_self_rating (0..1).

Дополнительно (backward-compat для UI, заполняй кратко по данным):
- skills: { name, level: junior|middle|senior|expert, evidence }
- decision_patterns: { pattern, examples }
- common_pitfalls: { description, frequency_observation: «часто»|«иногда»|«однажды» }

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
  const themes = ctx.themes.map((t) => `- ${t.name}: ${t.description}`).join('\n');
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
    ctx.jobDescriptionMd ? ctx.jobDescriptionMd : '— должностная инструкция не загружена',
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
