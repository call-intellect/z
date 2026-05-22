/**
 * SBA α-7 — Specialist 3.1 (Regulations).
 *
 * LLM-арбитр `regulation-dedupe` — решает, что делать с черновиком от
 * `regulation-extract`:
 *   - `new` — новая запись;
 *   - `merge` — обновить существующую;
 *   - `extension` — добавить как дополнение / уточнение (новая версия
 *     поверх supersedesId);
 *   - `contradicts` — противоречит существующей (создать ConflictItem).
 *
 * На вход — черновик + top-K (≤5) cosine-кандидатов того же `kind` в Org.
 *
 * TODO(owner-product): согласовать финальный текст промпта (см. зонтичный SBA §10).
 * Сейчас — placeholder. Цель: дешёвый арбитр (≤500 input + ≤200 output tokens).
 */

export const REGULATION_DEDUPE_SYSTEM_PROMPT = [
  'Ты — knowledge-арбитр. Тебе дают черновик карточки (Regulation / Process / Policy) и top-K похожих существующих карточек той же категории.',
  'Реши: эта карточка новая или дубликат / уточнение / противоречие.',
  '',
  'Возможные decisions:',
  '- "new" — нет совпадений по сути.',
  '- "merge" — это та же сущность, просто другие формулировки → обновить существующую (укажи targetId).',
  '- "extension" — расширяет / уточняет существующую → создаётся новая версия поверх supersedesId.',
  '- "contradicts" — прямо противоречит существующей (например, «договоры подписывает PM» vs «договоры подписывает CEO») → нужен ConflictItem.',
  '',
  'Будь консервативен: «merge» только при ≥80% уверенности. На сомнении — «new». Отвечай строго в формате JSON по схеме regulation_dedupe_v1.',
].join('\n');

export const REGULATION_DEDUPE_USER_TEMPLATE = (args: {
  draft: {
    kind: string;
    name: string;
    statement: string;
    scope?: string | null;
  };
  candidates: ReadonlyArray<{
    id: string;
    name: string;
    statement: string;
    scope?: string | null;
  }>;
}): string => {
  const draftLines = [
    `Черновик (${args.draft.kind}):`,
    `  name: ${args.draft.name}`,
    `  statement: ${args.draft.statement}`,
    `  scope: ${args.draft.scope ?? '(не указано)'}`,
  ].join('\n');
  const candidatesText = args.candidates.length
    ? args.candidates
        .map((c, i) => {
          return [
            `Кандидат #${i + 1} (id=${c.id}):`,
            `  name: ${c.name}`,
            `  statement: ${c.statement}`,
            `  scope: ${c.scope ?? '(не указано)'}`,
          ].join('\n');
        })
        .join('\n\n')
    : '(нет кандидатов — это новая карточка)';
  return `${draftLines}\n\n${candidatesText}\n\nВерни JSON по схеме regulation_dedupe_v1.`;
};

export const REGULATION_DEDUPE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'reasoning'],
  properties: {
    decision: {
      type: 'string',
      enum: ['new', 'merge', 'extension', 'contradicts'],
    },
    targetId: {
      type: ['string', 'null'],
      description:
        'id кандидата для merge/extension/contradicts; null для new',
    },
    reasoning: { type: 'string', maxLength: 2_000 },
  },
};

export const REGULATION_DEDUPE_SCHEMA_NAME = 'regulation_dedupe_v1';
