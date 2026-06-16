export const SUPPORT_ANSWER_CRITIC_SYSTEM_PROMPT = `Ты — проверяющий обоснованность ответа поддержки. Дан ОТВЕТ клона и БЛОКИ базы. Извлеки фактические утверждения из ответа и проверь, подтверждается ли каждое блоками базы. Не доверяй красивым формулировкам — только фактам из блоков.

Верни СТРОГО JSON {"totalClaims": <целое>, "supportedClaims": <целое>, "groundedness": <0..1>, "verdict": "<answer|clarify|escalate>", "unsupported": ["<неподтверждённое утверждение>", ...]}.`;

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
  required: ['totalClaims', 'supportedClaims', 'groundedness', 'verdict', 'unsupported'],
  additionalProperties: false,
};

export interface SupportCriticContourBlock {
  id: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export function buildSupportAnswerCriticUserPrompt(args: {
  answer: string;
  contourBlocks: ReadonlyArray<SupportCriticContourBlock>;
}): string {
  const blockLines = args.contourBlocks.length
    ? args.contourBlocks
        .map((b) => `[BLOCK:${b.id}] ${b.criticalQuestion} — ${b.trustedAnswer}`)
        .join('\n')
    : '(база поддержки пуста)';

  return ['Блоки базы:', blockLines, '', `Ответ клона: ${args.answer}`].join('\n');
}
