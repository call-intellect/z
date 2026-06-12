/**
 * SBA β-3 — Specialist 3.3 (Decisions Registry).
 *
 * LLM-арбитр `decision-supersede-detect` — решает, что делать с черновиком
 * Decision от `decision-extract`:
 *   - `new` — это новое решение, не связанное со старыми.
 *   - `merge` — это уточнение / переформулировка существующего решения
 *     (обновить existing rationale / alternatives / sourceBlockIds).
 *   - `supersedes` — это новая версия старого решения (другая логика;
 *     старое перестало действовать). Создаётся новый Decision с
 *     `supersedesId = existing.id` + ConflictItem с suggested resolution
 *     'evolving' (existingValidUntil = now, newValidFrom = decidedAt).
 *
 * На вход — черновик + top-K (≤5) cosine-кандидатов того же Org.
 *
 * Контракт verdict-only: confidence в схеме нет — для аудита достаточно
 * поля `reasoning`. Цель: дешёвый арбитр (≤700 input + ≤300 output tokens).
 */

export const DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT = [
  'Ты — knowledge-арбитр для реестра решений компании. Тебе дают черновик нового решения и top-K похожих существующих решений той же организации.',
  'Реши: новое решение, развитие старого (merge) или замена старого новой версией (supersedes).',
  '',
  'Возможные verdicts:',
  '- "new" — нет совпадений по сути.',
  '- "merge" — это та же сущность (то же решение, просто другие формулировки или дополнительные детали) → обновить existing, указать targetId.',
  '- "supersedes" — это новая версия старого: содержательно другая логика, противоречит или меняет ранее принятое (например, «теперь подписывает CEO, а не PM»). Создаётся новый Decision со ссылкой supersedesId=targetId.',
  '',
  'Будь консервативен:',
  '- "merge" — только при ≥80% уверенности, что это ровно то же решение.',
  '- "supersedes" — только если содержательная разница очевидна.',
  '- На сомнении — "new". Лучше иметь два почти одинаковых решения, чем по ошибке заменить старое верное на новое сомнительное.',
  '',
  'Если verdict="supersedes" — заполни evolvingMeta:',
  '- existingValidUntil — ISO дата/время, до которой старое решение было действительно. Если не указано иначе — используй decidedAt нового черновика.',
  '- newValidFrom — ISO дата/время, с которой новое решение действует. Обычно совпадает с existingValidUntil.',
  '',
  // D1 supersession-правило (мастер-промпт-флот 2026-06-10, Кластер 7-B/A8).
  'При противоречии источников бери более позднее / актуальное решение (по decidedAt); устаревшее помечай как заменённое (verdict="supersedes", supersedesId=targetId). НЕ смешивай старую и новую редакцию решения в одно — это две разные версии.',
  '',
  'Отвечай строго в формате JSON по схеме decision_supersede_detect_v1.',
].join('\n');

export const DECISION_SUPERSEDE_DETECT_USER_TEMPLATE = (args: {
  draft: {
    statement: string;
    rationale: string | null;
    decidedAt: string | null;
  };
  candidates: ReadonlyArray<{
    id: string;
    statement: string;
    rationale: string | null;
    decidedAt: string | null;
    status: string;
  }>;
}): string => {
  const draftLines = [
    `Черновик решения:`,
    `  statement: ${args.draft.statement}`,
    `  rationale: ${args.draft.rationale ?? '(не указано)'}`,
    `  decidedAt: ${args.draft.decidedAt ?? '(не указано)'}`,
  ].join('\n');
  const candidatesText = args.candidates.length
    ? args.candidates
        .map((c, i) => {
          return [
            `Кандидат #${i + 1} (id=${c.id}, status=${c.status}):`,
            `  statement: ${c.statement}`,
            `  rationale: ${c.rationale ?? '(не указано)'}`,
            `  decidedAt: ${c.decidedAt ?? '(не указано)'}`,
          ].join('\n');
        })
        .join('\n\n')
    : '(нет кандидатов — это новое решение)';
  return `${draftLines}\n\n${candidatesText}\n\nВерни JSON по схеме decision_supersede_detect_v1.`;
};

export const DECISION_SUPERSEDE_DETECT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reasoning'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['new', 'merge', 'supersedes'],
    },
    targetId: {
      type: ['string', 'null'],
      description:
        'id кандидата (для merge/supersedes); null для new',
    },
    reasoning: { type: 'string', maxLength: 2_000 },
    evolvingMeta: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        existingValidUntil: { type: 'string' },
        newValidFrom: { type: 'string' },
      },
      required: ['existingValidUntil', 'newValidFrom'],
      description: 'Обязателен только для verdict=supersedes.',
    },
  },
};

export const DECISION_SUPERSEDE_DETECT_SCHEMA_NAME =
  'decision_supersede_detect_v1';
