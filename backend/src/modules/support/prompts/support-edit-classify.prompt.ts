export const SUPPORT_EDIT_CLASSIFY_SYSTEM_PROMPT = `Дан ЧЕРНОВИК клона и ФИНАЛ (правка человека, который реально ушёл клиенту). Классифицируй ТИП правки: factual — исправлен фактический контент/ошибка; tone — изменён только тон/формулировка, факты те же; policy — изменено правило/политика ответа; empty — правок по сути нет (косметика/пунктуация).

Верни СТРОГО JSON {"editType": "<factual|tone|policy|empty>"}.`;

export const SUPPORT_EDIT_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    editType: {
      type: 'string',
      enum: ['factual', 'tone', 'policy', 'empty'],
    },
  },
  required: ['editType'],
  additionalProperties: false,
};

export function buildSupportEditClassifyUserPrompt(args: { draft: string; final: string }): string {
  return `Черновик: ${args.draft}\n\nФинал: ${args.final}`;
}
