/**
 * Agents v2 Фаза C1 (2026-05-30) — PracticeSkill extract prompt.
 *
 * Вход: SkillTraitConcept + связанные SkillTrait'ы + reasoning-блоки employee'я
 * (signalType ∈ {reasoning, rationale, decision_basis}).
 * Выход (JSON): draft PracticeSkill {trigger, steps[], redFlags[], reasoning}
 * или `skill: null` если в блоках нет конкретных шагов (общая черта характера —
 * не процедура).
 *
 * Cache-friendly (см. second-brain/02_architecture/llm-cache-status.md):
 *   - SYSTEM полностью статичен → cache-hit у DeepSeek/OpenAI-via-proxy.
 *   - Все переменные (concept name + traits + blocks) — в КОНЦЕ USER.
 *   - Префикс USER одинаков для всех вызовов одного типа.
 *
 * Источник доказательств:
 *   - Voyager (NeurIPS 2023) — выполняемые навыки (skill library) ускоряют
 *     обучение в 15.3× по сравнению с фристайл-промптами.
 *   - SkillWeaver (arxiv 2504.07079) — explicit recipe «когда X → делай Y»
 *     даёт +31.8% на WebArena и +54.3% на transfer-задачах.
 */

export const PRACTICE_SKILL_EXTRACT_SYSTEM_PROMPT = [
  'Ты — Кора. Тебе дают смысловой блок навыка сотрудника + примеры его рассуждений.',
  'Твоя задача — извлечь из этого ВЫПОЛНЯЕМУЮ ПРОЦЕДУРУ (рецепт):',
  '  «Когда происходит ТРИГГЕР — делай шаг 1, потом шаг 2, потом шаг 3».',
  '',
  'КЛЮЧЕВОЕ ОТЛИЧИЕ:',
  '  - Черта характера / стиль («осторожен с оценками сроков») — это НЕ процедура. Верни skill=null.',
  '  - Принцип («всегда уважает клиента») — это НЕ процедура. Верни skill=null.',
  '  - Конкретная последовательность действий («когда клиент возражает на цену → сначала уточняю boundary условий, потом предлагаю split-payment, потом эскалирую») — это процедура, извлекай.',
  '',
  'Триггер должен быть КОНКРЕТНЫМ:',
  '  ✓ «когда клиент возражает на цену enterprise-пакета»',
  '  ✓ «когда новый разработчик не может оценить срок задачи на собеседовании»',
  '  ✗ «когда обсуждаю цены» (слишком общо)',
  '  ✗ «когда работаю с клиентом» (не триггер)',
  '',
  'Шаги должны быть ДЕЙСТВИЯМИ от первого лица в инфинитиве:',
  '  ✓ «Уточнить boundary условия: бюджет, сроки, критерии успеха»',
  '  ✗ «Уточнение условий» (это название этапа, не действие)',
  '',
  'Если шагов меньше 2 — это не процедура, верни skill=null.',
  'Если в блоках видна только мотивация / результат, но не сама последовательность — верни skill=null.',
  '',
  'redFlags — что НЕЛЬЗЯ делать в этой процедуре. Извлекай ТОЛЬКО если явно',
  'упомянуто в блоках («ни в коем случае не…», «никогда не…», «избегаю …»).',
  'Не выдумывай redFlags из общих соображений.',
  '',
  'reasoning — 1-3 предложения, почему именно эти шаги. Без воды.',
  '',
  'confidence:',
  '  ≥0.85 — очень уверен (3+ блока подтверждают, шаги явно последовательны),',
  '  ≥0.7  — уверен (2 блока подтверждают, последовательность ясна),',
  '  <0.7  — слабый сигнал, верни skill=null (не промоутить).',
  '',
  'Верни JSON строго по схеме practice_skill_extract_v1 на русском.',
].join('\n');

export interface PracticeSkillExtractBlock {
  id: string;
  text: string;
}

export interface PracticeSkillExtractInput {
  conceptName: string;
  /** Краткие формулировки трейтов: «осторожен с оценками сроков», ... */
  traitStatements: string[];
  /** Reasoning-блоки сотрудника. */
  blocks: PracticeSkillExtractBlock[];
}

/**
 * USER-шаблон. Переменные (concept name, traits, blocks) — в конце, чтобы
 * фиксированный префикс инструкции мог попасть в prompt-cache.
 */
export const PRACTICE_SKILL_EXTRACT_USER_TEMPLATE = (
  args: PracticeSkillExtractInput,
): string => {
  const traitsBlock =
    args.traitStatements.length > 0
      ? args.traitStatements
          .slice(0, 12)
          .map((t, i) => `  ${i + 1}. ${t}`)
          .join('\n')
      : '  (нет связанных трейтов)';

  const blocksBlock =
    args.blocks.length > 0
      ? args.blocks
          .slice(0, 12)
          .map((b, i) => `  ${i + 1}. [${b.id}] ${b.text.slice(0, 600)}`)
          .join('\n')
      : '  (нет reasoning-блоков)';

  return [
    'Извлеки выполняемую процедуру из рассуждений сотрудника.',
    '',
    `Смысловой блок навыка: «${args.conceptName}»`,
    '',
    'Формулировки трейтов (черты характера / принципы), к которым относится этот блок:',
    traitsBlock,
    '',
    'Reasoning-блоки сотрудника (объяснения «почему так решил» / «почему именно так делаю»):',
    blocksBlock,
    '',
    'Если в блоках видна конкретная последовательность шагов — извлеки процедуру.',
    'Иначе верни skill=null с понятным reasoning «почему это не процедура».',
    'JSON по схеме practice_skill_extract_v1.',
  ].join('\n');
};

export const PRACTICE_SKILL_EXTRACT_SCHEMA_NAME = 'practice_skill_extract_v1';

/**
 * JSON Schema (strict mode для OpenAI / DeepSeek structured output).
 *
 * `skill` либо полный объект, либо `null` (не путать с отсутствием поля —
 * именно `null` означает «не извлеклось» в этой схеме).
 */
export const PRACTICE_SKILL_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['skill', 'confidence'],
  properties: {
    skill: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['trigger', 'steps', 'redFlags', 'reasoning'],
          properties: {
            trigger: {
              type: 'string',
              minLength: 10,
              maxLength: 200,
              description:
                'Конкретный триггер: когда применяется процедура. От 10 до 200 символов на русском.',
            },
            steps: {
              type: 'array',
              minItems: 2,
              maxItems: 12,
              description:
                'Список шагов (2–12). Каждый шаг — действие от первого лица в инфинитиве.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['order', 'action'],
                properties: {
                  order: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 12,
                    description: 'Порядковый номер шага (1..12).',
                  },
                  action: {
                    type: 'string',
                    minLength: 5,
                    maxLength: 500,
                    description:
                      'Действие на этом шаге — что конкретно делать.',
                  },
                  emotionalRegister: {
                    type: 'string',
                    maxLength: 200,
                    description:
                      'Опционально — эмоциональный регистр на этом шаге («спокойно», «жёстко», «эмпатично»).',
                  },
                  redFlags: {
                    type: 'array',
                    maxItems: 5,
                    items: { type: 'string', maxLength: 200 },
                    description:
                      'Опционально — чего НЕЛЬЗЯ делать именно на этом шаге.',
                  },
                },
              },
            },
            redFlags: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string', maxLength: 200 },
              description:
                'Общие redFlags для всей процедуры — чего нельзя делать НИ НА КАКОМ шаге.',
            },
            reasoning: {
              type: 'string',
              minLength: 10,
              maxLength: 500,
              description:
                '1–3 предложения: почему именно такая процедура, какой паттерн в блоках навёл на эти шаги.',
            },
          },
        },
      ],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Уверенность в извлечённой процедуре: ≥0.85 очень уверен, ≥0.7 уверен, <0.7 слабый сигнал (extractor отбросит).',
    },
  },
};

// ───────────────────────────────────────────────────────────────────────
// Adversarial-verify (вторичный promпт, дешёвый Flash-tier)
// ───────────────────────────────────────────────────────────────────────

export const PRACTICE_SKILL_ADVERSARIAL_VERIFY_SYSTEM_PROMPT = [
  'Ты — Кора. Тебе дают: процедуру PracticeSkill (trigger + шаги + redFlags),',
  'и ответ клона на пользовательский вопрос, в котором эта процедура была',
  'подмешана как «известная роли процедура». Твоя задача — бинарная проверка:',
  '  - violatesRedFlags=true, если ответ ЯВНО нарушает хотя бы один redFlag,',
  '  - contradictsSteps=true, если ответ ПРЯМО противоречит хотя бы одному шагу,',
  '  - иначе оба false.',
  '',
  'Не оценивай стиль / уместность / полезность — только эти два бинарных факта.',
  'Если нарушения нет — ставь false (не выдумывай «возможные» нарушения).',
  'Верни JSON по схеме practice_skill_adversarial_verify_v1.',
].join('\n');

export const PRACTICE_SKILL_ADVERSARIAL_VERIFY_USER_TEMPLATE = (args: {
  trigger: string;
  steps: ReadonlyArray<{ order: number; action: string }>;
  redFlags: ReadonlyArray<string>;
  cloneAnswer: string;
}): string => {
  const stepsBlock =
    args.steps.length > 0
      ? args.steps
          .map((s) => `  ${s.order}. ${s.action}`)
          .join('\n')
      : '  (шагов нет)';
  const flagsBlock =
    args.redFlags.length > 0
      ? args.redFlags.map((f, i) => `  ${i + 1}. ${f}`).join('\n')
      : '  (redFlags нет — тогда violatesRedFlags всегда false)';

  return [
    'Проверь ответ клона на нарушения процедуры.',
    '',
    `Триггер процедуры: ${args.trigger}`,
    '',
    'Шаги процедуры:',
    stepsBlock,
    '',
    'redFlags процедуры:',
    flagsBlock,
    '',
    'Ответ клона (фрагмент, ≤2000 символов):',
    args.cloneAnswer.slice(0, 2000),
    '',
    'JSON по схеме practice_skill_adversarial_verify_v1.',
  ].join('\n');
};

export const PRACTICE_SKILL_ADVERSARIAL_VERIFY_SCHEMA_NAME =
  'practice_skill_adversarial_verify_v1';

export const PRACTICE_SKILL_ADVERSARIAL_VERIFY_JSON_SCHEMA: Record<
  string,
  unknown
> = {
  type: 'object',
  additionalProperties: false,
  required: ['violatesRedFlags', 'contradictsSteps', 'reasoning'],
  properties: {
    violatesRedFlags: {
      type: 'boolean',
      description: 'true, если ответ явно нарушает один из redFlags.',
    },
    contradictsSteps: {
      type: 'boolean',
      description:
        'true, если ответ прямо противоречит хотя бы одному шагу процедуры.',
    },
    reasoning: {
      type: 'string',
      minLength: 5,
      maxLength: 300,
      description:
        'Краткое объяснение вердикта (1–2 предложения). При false-false — «нарушений не обнаружено».',
    },
  },
};
