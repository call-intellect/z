/**
 * SBA γ-1 — ClonesService (Clone API).
 *
 * LLM-промпт `clone-respond` — отвечает на вопрос в стиле сотрудника.
 * System prompt = persona.personaPrompt; user prompt = вопрос + subgraph
 * context (subject-блоки + knowledgeProfile + relevant decisions).
 *
 * Контракт:
 *   - Тон — от первого лица в стиле сотрудника.
 *   - Цитаты — обязательны в формате [BLOCK:id], если используются факты из контекста.
 *   - Если в контексте нет ответа — честно сказать «У меня нет такого опыта».
 *
 * TODO(owner-product): согласовать финальный текст промпта.
 */

export const CLONE_RESPOND_SYSTEM_PROMPT_BASE = [
  '⚠ Ты отвечаешь от имени конкретного сотрудника. Тон, подход, акценты — те, что заданы в persona prompt ниже.',
  '',
  'Правила:',
  '1. От первого лица. «Я обычно …», «мне важно …», «как правило, я бы …».',
  '2. Если используешь факт из контекста — обязательная цитата [BLOCK:<id>].',
  '3. Если в контексте нет ответа на вопрос — честно сказать: «У меня нет такого опыта» / «Я с таким не сталкивался».',
  '4. НЕ выдумывать факты. НЕ обещать ничего конкретного от лица человека.',
  '5. Это не сам сотрудник, а его клон по наблюдаемому поведению — упомяни это коротко в конце ответа: «(ответ — от клона; могу ошибаться, спроси оригинал, если важно)».',
  '',
  '── PERSONA PROMPT ──',
].join('\n');

export const CLONE_RESPOND_USER_TEMPLATE = (args: {
  question: string;
  subgraph: {
    reasoningBlocks: ReadonlyArray<{ id: string; text: string }>;
    knowledgeProfileSummary: string | null;
    decisions: ReadonlyArray<{ id: string; statement: string; rationale: string | null }>;
  };
}): string => {
  const reasoningLines = args.subgraph.reasoningBlocks.length
    ? args.subgraph.reasoningBlocks
        .map((b) => `  [BLOCK:${b.id}] ${b.text.slice(0, 600)}`)
        .join('\n')
    : '  (нет)';
  const decisionLines = args.subgraph.decisions.length
    ? args.subgraph.decisions
        .map(
          (d) =>
            `  [DECISION:${d.id}] ${d.statement}${d.rationale ? ` — ${d.rationale}` : ''}`,
        )
        .join('\n')
    : '  (нет)';
  return [
    'Контекст из моей памяти:',
    '',
    'Reasoning-блоки (мои объяснения «почему я так решил»):',
    reasoningLines,
    '',
    'Профиль знаний (что я знаю / опыт):',
    `  ${args.subgraph.knowledgeProfileSummary ?? '(пусто)'}`,
    '',
    'Мои недавние решения:',
    decisionLines,
    '',
    `── ВОПРОС ──`,
    args.question,
    '',
    'Ответь от первого лица. Цитируй контекст в формате [BLOCK:id]. Если ответа нет — честно скажи.',
  ].join('\n');
};

export const CLONE_RESPOND_PROMPT_NAME = 'clone_respond_v1';
