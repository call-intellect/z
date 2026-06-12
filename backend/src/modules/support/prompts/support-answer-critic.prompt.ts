/**
 * Support desk Ф3 (TZ 2026-06-09 support-desk-clone-and-closed-contour) —
 * промпт critic'а обоснованности для taskType `support-answer-critic` (R-INV-5).
 *
 * Анти-галлюцинация: дешёвый judge (deepseek-v4-flash, Б9) извлекает
 * фактические утверждения из ответа клона и проверяет, подтверждается ли
 * каждое блоками закрытого контура. groundedness = supportedClaims/totalClaims;
 * ниже порога `support_critic_min_groundedness` (AdminSetting) → исход
 * `clarify`/`escalate`, а не `answer`.
 *
 * CACHE-FRIENDLY: SYSTEM СТАБИЛЬНЫЙ — без переменных данных. Ответ клона и
 * контур-блоки уходят в КОНЕЦ user (buildSupportAnswerCriticUserPrompt).
 */

export const SUPPORT_ANSWER_CRITIC_SYSTEM_PROMPT = `Ты — проверяющий обоснованность ответа поддержки. Дан ОТВЕТ клона и БЛОКИ базы. Извлеки фактические утверждения из ответа и проверь, подтверждается ли каждое блоками базы. Не доверяй красивым формулировкам — только фактам из блоков.

Верни СТРОГО JSON {"totalClaims": <целое>, "supportedClaims": <целое>, "groundedness": <0..1>, "verdict": "<answer|clarify|escalate>", "unsupported": ["<неподтверждённое утверждение>", ...]}.`;

/**
 * JSON Schema для `responseFormat: json_schema strict`. Все поля обязательны,
 * `additionalProperties: false`. Порядок стабилен (cache).
 */
export const SUPPORT_ANSWER_CRITIC_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    totalClaims: {
      type: 'integer',
      minimum: 0,
    },
    supportedClaims: {
      type: 'integer',
      minimum: 0,
    },
    groundedness: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    verdict: {
      type: 'string',
      enum: ['answer', 'clarify', 'escalate'],
    },
    unsupported: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'totalClaims',
    'supportedClaims',
    'groundedness',
    'verdict',
    'unsupported',
  ],
  additionalProperties: false,
};

/** Блок закрытого контура поддержки (зеркало support-clone-draft.prompt). */
export interface SupportCriticContourBlock {
  id: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

/**
 * USER-часть: блоки базы + ответ клона ПОСЛЕДНИМ. Cache-safe — переменное
 * только здесь, SYSTEM не трогаем.
 */
export function buildSupportAnswerCriticUserPrompt(args: {
  answer: string;
  contourBlocks: ReadonlyArray<SupportCriticContourBlock>;
}): string {
  const blockLines = args.contourBlocks.length
    ? args.contourBlocks
        .map(
          (b) =>
            `[BLOCK:${b.id}] ${b.criticalQuestion} — ${b.trustedAnswer}`,
        )
        .join('\n')
    : '(база поддержки пуста)';

  return ['Блоки базы:', blockLines, '', `Ответ клона: ${args.answer}`].join(
    '\n',
  );
}
