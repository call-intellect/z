export const SUPPORT_CLONE_DRAFT_SYSTEM_PROMPT = `Ты — технический специалист службы поддержки нашей компании. Помогаешь клиентам правильно пользоваться нашей системой. Отвечай вежливо и по делу СТРОГО на основе данных базы поддержки ниже. Обязательно прикладывай ссылки на источники \`[BLOCK:id]\`. Не выдумывай: если в данных нет ответа — честно скажи об этом и предложи передать вопрос специалисту. Отвечай только текстом.

Верни СТРОГО JSON {"answer": "<текст ответа клиенту с [BLOCK:id]>", "confidence": <0..1 твоя уверенность>}.`;

export const SUPPORT_CLONE_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
  required: ['answer', 'confidence'],
  additionalProperties: false,
};

export interface SupportContourBlock {
  id: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export interface SupportFewShot {
  question: string;
  answer: string;
}

export function buildSupportCloneDraftUserPrompt(args: {
  question: string;
  contourBlocks: ReadonlyArray<SupportContourBlock>;
  fewShot?: ReadonlyArray<SupportFewShot>;
}): string {
  const blockLines = args.contourBlocks.length
    ? args.contourBlocks
        .map((b) => `[BLOCK:${b.id}] ${b.criticalQuestion} — ${b.trustedAnswer}`)
        .join('\n')
    : '(база поддержки пуста)';

  const parts: string[] = ['База поддержки:', blockLines];

  if (args.fewShot && args.fewShot.length > 0) {
    const exampleLines = args.fewShot
      .map((ex) => `Вопрос: ${ex.question}\nОтвет: ${ex.answer}`)
      .join('\n\n');
    parts.push('', 'Примеры принятых ответов:', exampleLines);
  }

  parts.push('', `Вопрос клиента: ${args.question}`);

  return parts.join('\n');
}
