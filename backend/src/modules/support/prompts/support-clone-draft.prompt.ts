/**
 * Support desk Ф3 (TZ 2026-06-09 support-desk-clone-and-closed-contour) —
 * промпт клона техподдержки для taskType `support-clone-draft`.
 *
 * Клон готовит ЧЕРНОВИК ответа клиенту СТРОГО из закрытого контура памяти
 * (R-INV-1: контур-блоки уже отфильтрованы pre-retrieval до показа модели) +
 * few-shot принятых пар. Сотрудник правит/отправляет — человек шлёт всегда
 * (Ф1–Ф3, Р-5).
 *
 * CACHE-FRIENDLY (second-brain/02_architecture/llm-cache-status.md):
 * SYSTEM СТАБИЛЬНЫЙ — внутри НЕТ переменных данных (вопрос клиента,
 * контур-блоки, few-shot). Всё переменное уходит в КОНЕЦ user-сообщения
 * (buildSupportCloneDraftUserPrompt), вопрос клиента — самым последним.
 * Правка SYSTEM инвалидирует prompt cache → менять SYSTEM редко.
 *
 * SYSTEM-текст согласован владельцем 2026-06-09 (verbatim) — не переписывать.
 */

export const SUPPORT_CLONE_DRAFT_SYSTEM_PROMPT = `Ты — технический специалист службы поддержки нашей компании. Помогаешь клиентам правильно пользоваться нашей системой. Отвечай вежливо и по делу СТРОГО на основе данных базы поддержки ниже. Обязательно прикладывай ссылки на источники \`[BLOCK:id]\`. Не выдумывай: если в данных нет ответа — честно скажи об этом и предложи передать вопрос специалисту. Отвечай только текстом.

Верни СТРОГО JSON {"answer": "<текст ответа клиенту с [BLOCK:id]>", "confidence": <0..1 твоя уверенность>}.`;

/**
 * JSON Schema для `responseFormat: json_schema strict`. Оба поля обязательны,
 * `additionalProperties: false`. Хардкод — порядок стабилен (важно для cache).
 */
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

/** Блок закрытого контура поддержки (уже отфильтрован pre-retrieval, R-INV-1). */
export interface SupportContourBlock {
  id: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

/** Принятая пара (few-shot) — топ-N из SupportDraftOutcome (outcome=accepted/edited). */
export interface SupportFewShot {
  question: string;
  answer: string;
}

/**
 * USER-часть: база поддержки (контур-блоки) + опц. few-shot принятых ответов +
 * вопрос клиента ПОСЛЕДНИМ. Cache-safe — переменное только здесь, SYSTEM не
 * трогаем. Контент клиента — как ДАННЫЕ, не как инструкция (anti prompt-injection).
 */
export function buildSupportCloneDraftUserPrompt(args: {
  question: string;
  contourBlocks: ReadonlyArray<SupportContourBlock>;
  fewShot?: ReadonlyArray<SupportFewShot>;
}): string {
  const blockLines = args.contourBlocks.length
    ? args.contourBlocks
        .map(
          (b) =>
            `[BLOCK:${b.id}] ${b.criticalQuestion} — ${b.trustedAnswer}`,
        )
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
