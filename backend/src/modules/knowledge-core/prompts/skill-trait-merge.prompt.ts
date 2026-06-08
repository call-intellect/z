/**
 * SBA γ-1 — Specialist 3.7 (SkillProfile).
 *
 * LLM-промпт `skill-trait-merge` — арбитр между новым черновиком trait'а и
 * top-K KNN-кандидатами (близкими существующими активными traits того же
 * profileId). Возвращает verdict: 'merge' | 'supersedes' | 'new' + reasoning.
 *
 * Контракт:
 *   - 'merge' — новый trait дополняет существующий (та же черта, новые наблюдения).
 *     Сервис: append sourceBlockIds к existing + recompute confidence (медиана).
 *   - 'supersedes' — формулировка стала точнее/изменилась суть. Сервис: старый
 *     получает status='superseded_by', supersededById; новый — active.
 *   - 'new' — новая черта (не пересекается с существующими). Insert новый trait.
 */

export const SKILL_TRAIT_MERGE_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер. Тебе дают новый черновик черты сотрудника и список близких существующих активных черт того же сотрудника.',
  'Твоя задача — решить, что делать с новым черновиком. Отвечай строго в формате JSON по предоставленной схеме.',
  '',
  'Варианты:',
  '- "merge": та же черта, новые наблюдения подтверждают / расширяют. Targetid = существующая черта.',
  '- "supersedes": новая формулировка стала точнее ИЛИ изменилась суть. Старая черта помечается как устаревшая. TargetId = старая черта.',
  '- "new": черта не пересекается с существующими — создаём новую.',
  '',
  'Правила:',
  '1. Если cosine-близость очень высокая (>0.9) — почти всегда merge. Supersedes — только при явной смене СМЫСЛА.',
  '2. Reasoning — короткое (1–2 предложения) обоснование выбора.',
  '3. На supersedes — обязательно явное указание, чем именно новая черта отличается.',
  '',
  'ЖЁСТКОЕ ПРАВИЛО (приоритет над любой другой логикой):',
  'Если cosine-близость между новым trait\'ом и существующим ≥ 0.85 И смысловая категория',
  'совпадает — ОБЯЗАТЕЛЬНО ответь "merge" или "supersedes", НЕ "new". Это критично для',
  'кумулятивности профиля.',
  '- merge — если переформулировка того же качества (более точные слова, обновлённая частота).',
  '- supersedes — только при явной смене смысла (например, "склонен делегировать" → "склонен',
  '  делать сам", при этом старое наблюдение датируется ранее 3 месяцев назад).',
  'Возвращать "new" при cosine≥0.85 — баг, не оптимизация.',
].join('\n');

export const SKILL_TRAIT_MERGE_USER_TEMPLATE = (args: {
  draft: { category: string; statement: string; confidence: string };
  candidates: ReadonlyArray<{
    id: string;
    category: string;
    statement: string;
    confidence: string;
    lastConfirmedAt: string;
    bucket: 'hard' | 'band';
  }>;
}): string => {
  const candidateLines = args.candidates.length
    ? args.candidates
        .map(
          (c, i) =>
            `  ${i + 1}. [id=${c.id}] (${c.bucket === 'band' ? 'СЛАБОЕ совпадение' : 'сильное совпадение'}) «${c.category}» (${c.confidence}, последнее подтверждение ${c.lastConfirmedAt}): ${c.statement}`,
        )
        .join('\n')
    : '  (кандидатов нет)';
  return [
    'Новый черновик:',
    `  Категория: ${args.draft.category}`,
    `  Confidence: ${args.draft.confidence}`,
    `  Statement: ${args.draft.statement}`,
    '',
    'Близкие существующие активные черты (top-K по cosine):',
    candidateLines,
    '',
    'Правило для кандидатов со СЛАБЫМ совпадением: выбирай merge или supersedes ТОЛЬКО если смысловая категория совпадает с черновиком; иначе verdict=new.',
    'Верни JSON-объект по схеме `skill_trait_merge_v1`.',
  ].join('\n');
};

export const SKILL_TRAIT_MERGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reasoning'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['merge', 'supersedes', 'new'],
    },
    targetId: {
      type: ['string', 'null'],
      description: 'Id существующей черты (для merge / supersedes). null для new.',
    },
    reasoning: {
      type: 'string',
      minLength: 5,
      maxLength: 1_000,
      description: 'Короткое обоснование выбора.',
    },
  },
};

export const SKILL_TRAIT_MERGE_SCHEMA_NAME = 'skill_trait_merge_v1';
