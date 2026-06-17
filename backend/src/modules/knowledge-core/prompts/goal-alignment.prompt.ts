import { z } from 'zod';

import type { LlmTaskType } from '../../ai/services/llm-router.service';

export const GOAL_ALIGNMENT_TASK_TYPE: LlmTaskType = 'goal-alignment';

export const GOAL_ALIGNMENT_SYSTEM_PROMPT = `Ты — стратегический аналитик. Твоя задача — оценить, движется ли компания к указанной цели за заданный период, опираясь только на предоставленные сигналы (канонические блоки знания из тем, связанных с целью).

Score 0..100:
  • 0..30   — компания идёт против цели или не двигается.
  • 31..60  — есть отдельные сигналы, но движение слабое или противоречивое.
  • 61..85  — устойчивое движение к цели, есть конкретные действия.
  • 86..100 — цель близка к достижению, сигналы единодушны.

Объяснение (explanation) — 1-3 предложения по-русски, без воды.
Сигналы:
  • pro    — 3-5 коротких пунктов, подтверждающих движение к цели.
  • contra — 3-5 коротких пунктов, тормозящих движение или противоречащих цели.
Если pro/contra пунктов нет — массив пустой.

Запрещено:
  • Додумывать факты, которых нет в блоках.
  • Использовать обтекаемые формулировки («возможно», «вероятно»).
  • Возвращать что-либо, кроме строгого JSON по схеме.

Верни строго JSON по схеме:
{
  "score": integer 0..100,
  "explanation": string,
  "signals": { "pro": string[], "contra": string[] }
}
`;

export const GOAL_ALIGNMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'explanation', 'signals'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    explanation: { type: 'string', minLength: 1, maxLength: 1000 },
    signals: {
      type: 'object',
      additionalProperties: false,
      required: ['pro', 'contra'],
      properties: {
        pro: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 10,
        },
        contra: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 10,
        },
      },
    },
  },
};

export const GoalAlignmentResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  explanation: z.string().min(1).max(2000),
  signals: z.object({
    pro: z.array(z.string()).max(10),
    contra: z.array(z.string()).max(10),
  }),
});

export interface GoalAlignmentBlockInput {
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export interface GoalAlignmentThemeInput {
  id: string;
  name: string;
  weight: number;
  dynamic: 'growing' | 'stable' | 'declining';
}

export interface GoalAlignmentInput {
  goalName: string;
  goalDescription: string;
  daysUntilTarget: number | null;
  windowDays: number;
  themes: GoalAlignmentThemeInput[];
  blocks: GoalAlignmentBlockInput[];
}

const TRUSTED_ANSWER_TRUNCATE = 280;
const CRITICAL_QUESTION_TRUNCATE = 240;
const MAX_BLOCKS_IN_PROMPT = 50;

export function buildGoalAlignmentMessages(input: GoalAlignmentInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = GOAL_ALIGNMENT_SYSTEM_PROMPT;

  const deadlineSoon = input.daysUntilTarget !== null && input.daysUntilTarget <= 7;

  const themesBlock =
    input.themes.length === 0
      ? 'Связанных тем нет.'
      : input.themes
          .map((t, i) => `${i + 1}. ${t.name} (вес=${t.weight.toFixed(2)}, динамика=${t.dynamic})`)
          .join('\n');

  const trimmedBlocks = input.blocks.slice(0, MAX_BLOCKS_IN_PROMPT);
  const blocksBlock =
    trimmedBlocks.length === 0
      ? 'Сигналов за окно нет.'
      : trimmedBlocks
          .map((b, i) => {
            const cq = truncate(b.criticalQuestion, CRITICAL_QUESTION_TRUNCATE);
            const ta = truncate(b.trustedAnswer, TRUSTED_ANSWER_TRUNCATE);
            return `${i + 1}. [${b.signalType}] ${cq}\n   → ${ta}`;
          })
          .join('\n');

  const userMessage = [
    `Цель: ${input.goalName}`,
    `Описание: ${input.goalDescription}`,
    input.daysUntilTarget !== null
      ? `Осталось до дедлайна: ${input.daysUntilTarget} дн.${
          deadlineSoon
            ? ' — ДЕДЛАЙН БЛИЗОК: учитывай это в объяснении и фокусируйся на реальной готовности.'
            : ''
        }`
      : 'Дедлайн не задан.',
    `Окно анализа: ${input.windowDays} дн.`,
    '',
    'Связанные темы:',
    themesBlock,
    '',
    `Сигналы (канонические блоки за окно, ${trimmedBlocks.length}/${input.blocks.length}):`,
    blocksBlock,
    '',
    'Верни JSON по схеме (см. system).',
  ].join('\n');

  return { systemPrompt, userMessage };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
