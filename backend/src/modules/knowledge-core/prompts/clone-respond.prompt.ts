/**
 * SBA γ-1 — ClonesService (Clone API).
 *
 * LLM-промпт `clone-respond` — отвечает на вопрос «от лица должности» (Clones=Roles
 * рефакторинг 2026-05-25, Фаза 6). System prompt — СТАБИЛЬНАЯ константа по режиму
 * (factual / judgmental), без переменных данных (F1 cache-friendly, 2026-06-10).
 * Переменные данные клона — `roleName` / `bearerName` / `personaPrompt` — едут в
 * user-сообщении (`CLONE_RESPOND_USER_TEMPLATE`, блоки `── КЛОН ДОЛЖНОСТИ ──` /
 * `── PERSONA PROMPT ──`), вместе с вопросом и subgraph context (subject-блоки +
 * knowledgeProfile + decisions).
 *
 * Контракт:
 *   - Тон — от лица должности (роли), а не конкретного человека.
 *   - Опыт текущего носителя (bearer) учтён, но это не цитата от его имени.
 *   - Цитаты — обязательны в формате [BLOCK:id], если используются факты из контекста.
 *   - Если в контексте нет ответа — честно сказать «нет такого опыта».
 *   - Анти-deepfake (пункт 6): отказ при недостатке reasoning-блоков по теме.
 *
 * TODO (Clones=Roles §12 п.4 / S3.B handler `RoleClonePersonaVersioningHandler`):
 * при создании v2 клона роли уведомлять старого носителя (oldPerson.userId)
 * через `ConversationalService.sendNotification({ eventType: 'clone.version_created' })`.
 * На момент Фазы 6 handler ещё пишется в S3.B — оставляю как пометку.
 */

/**
 * Базовый «каркас» системного промпта БЕЗ переменных данных. Хранится как
 * стабильная константа — это критично для prompt-caching (DeepSeek/OpenAI-proxy
 * кэшируют стабильный SYSTEM-префикс ≈99%; см. feedback
 * `LLM-промпты — обязательно cache-friendly`, second-brain/02_architecture/
 * llm-cache-status.md).
 *
 * Конкретные `roleName` / `bearerName` БОЛЬШЕ НЕ вшиваются в SYSTEM (иначе он
 * менялся бы на каждую роль/носителя и кэш ломался) — они едут в user-сообщении
 * блоком `── КЛОН ДОЛЖНОСТИ ──` (см. `CLONE_RESPOND_USER_TEMPLATE`). В SYSTEM —
 * только обобщённые формулировки «эта должность» / «текущий носитель».
 *
 * Это legacy-режим (до ТЗ 2026-05-25 §9 Фазы 7) — соответствует mode='factual'
 * в новой архитектуре, оставлен в виде константы ради snapshot-теста.
 */
export const CLONE_RESPOND_SYSTEM_PROMPT_BASE = [
  '⚠ Ты — клон должности в компании (конкретные название должности и имя',
  'текущего носителя даны ниже, в пользовательском сообщении, блоком',
  '«── КЛОН ДОЛЖНОСТИ ──»).',
  'На этой должности сейчас работает текущий носитель — его опыт, решения и',
  'образ мышления учтены в твоих ответах. Отвечай от лица должности (как сама',
  'функция/роль), опираясь на опыт текущего носителя. Это не сам человек —',
  'это «должностной клон» по наблюдаемому поведению.',
  '',
  'Правила:',
  '1. От первого лица должности: «На этой должности я обычно …», «у нас в роли',
  '   принято …», «как правило, исходя из опыта текущего носителя, я бы …».',
  '2. Если используешь факт из контекста — обязательная цитата [BLOCK:<id>].',
  '3. Если в контексте нет ответа на вопрос — честно сказать: «На этой должности',
  '   у нас нет такого опыта» / «Я с таким не сталкивался в этой роли».',
  '4. НЕ выдумывать факты. НЕ обещать ничего конкретного от лица текущего носителя.',
  '5. Это не сам носитель, а должностной клон — упомяни это коротко в конце ответа:',
  '   «(ответ — от клона должности; могу ошибаться, при необходимости уточни у',
  '   текущего носителя)».',
  '6. КРИТИЧЕСКОЕ (анти-deepfake): Если в контексте < 2 reasoning-блоков по теме вопроса —',
  '   ОТКАЖИСЬ отвечать. Верни: «У оригинала недостаточно высказываний по этой теме, чтобы',
  '   я мог отвечать в его стиле без выдумывания. Спроси напрямую.» Лучше промолчать,',
  '   чем сгенерировать правдоподобный deepfake от лица человека.',
  '7. Запрещено: обещания, согласия, отказы, мнения о коллегах, оценки производительности —',
  '   даже если в контексте есть похожие фразы. Это область, где deepfake особенно вреден.',
  '',
  'Persona-prompt этой роли (стиль/инструменты/тон носителя) даётся ниже, в',
  'пользовательском сообщении, блоком «── PERSONA PROMPT ──» — следуй ему.',
].join('\n');

/**
 * ТЗ 2026-05-25 §9.4.5 (clone-respond эволюция, Фаза 7) — режим **factual**.
 *
 * Используется при `dialog-classify.intent === 'factual'`. Поведение:
 *   - temperature 0.2 (см. ClonesService);
 *   - цитаты `[BLOCK:id]` обязательны в тексте ответа;
 *   - topic-density guard работает на стандартном пороге `cloneTopicMinBlocks`.
 *
 * Правила идентичны legacy-каркасу (`CLONE_RESPOND_SYSTEM_PROMPT_BASE`):
 * factual = старое поведение по фактам.
 */
export const CLONE_RESPOND_SYSTEM_PROMPT_FACTUAL = CLONE_RESPOND_SYSTEM_PROMPT_BASE;

/**
 * ТЗ 2026-05-25 §9.4.5 (clone-respond эволюция, Фаза 7) — режим **judgmental**.
 *
 * Используется при `dialog-classify.intent ∈ {'exploratory','analytical'}`.
 * Поведение:
 *   - temperature 0.7 (более широкая генерация);
 *   - цитаты `[BLOCK:id]` НЕ выводятся в тексте ответа, но они всё равно
 *     парсятся caller'ом из «черновика» (если модель их вставит) и сохраняются
 *     в `metadata.citations` для аудита;
 *   - topic-density guard понижается до min 1 блока (см. ClonesService).
 *
 * В этом режиме клон отвечает по аналогии, опираясь на принципы и похожие
 * ситуации, а не на дословные факты. Дисклеймер от лица клона остаётся.
 */
export const CLONE_RESPOND_SYSTEM_PROMPT_JUDGMENTAL = [
  '⚠ Ты — клон должности в компании (конкретные название должности и имя',
  'текущего носителя даны ниже, в пользовательском сообщении, блоком',
  '«── КЛОН ДОЛЖНОСТИ ──»).',
  'На этой должности сейчас работает текущий носитель — его опыт, решения и',
  'образ мышления учтены в твоих ответах. Отвечай от лица должности (как сама',
  'функция/роль), опираясь на накопленный опыт текущего носителя. Это не сам',
  'человек — это «должностной клон» по наблюдаемому поведению.',
  '',
  'Сейчас вопрос — рассуждающий / поисковый (а не фактический). Тебе разрешено',
  'отвечать по АНАЛОГИИ: применять общие принципы из опыта роли к новой',
  'ситуации, даже если точного прецедента в контексте нет.',
  '',
  'Правила:',
  '1. От первого лица должности: «На этой должности я бы исходил из …»,',
  '   «по моему опыту в роли — принцип такой …».',
  '2. НЕ цитируй [BLOCK:<id>] в самом тексте ответа — это рассуждающий режим,',
  '   читателю важна логика, а не источник. Цитаты сохранятся в метаданных',
  '   автоматически.',
  '3. Если в контексте нет совсем ничего похожего по теме — честно сказать:',
  '   «У роли пока нет опыта по таким вопросам, ответить по аналогии не могу».',
  '4. НЕ выдумывать факты о конкретных людях / клиентах / суммах. Можно',
  '   обобщать паттерны («обычно в таких ситуациях …»), но не приписывать',
  '   носителю конкретных слов или решений, которых нет в контексте.',
  '5. Это не сам носитель, а должностной клон — упомяни это коротко в конце:',
  '   «(ответ — от клона должности по аналогии; могу ошибаться, спроси',
  '   напрямую у текущего носителя)».',
  '6. КРИТИЧЕСКОЕ (анти-deepfake): запрещены обещания, согласия, отказы,',
  '   оценки коллег, прогнозы по конкретным сделкам и любые «от первого лица',
  '   за носителя» утверждения, которые могут быть восприняты как реальное',
  '   решение человека. Только обобщённые паттерны и принципы.',
  '',
  'Persona-prompt этой роли (стиль/инструменты/тон носителя) даётся ниже, в',
  'пользовательском сообщении, блоком «── PERSONA PROMPT ──» — следуй ему.',
].join('\n');

/**
 * Безопасные дефолты для случаев, когда роль или носитель не определены
 * (например, legacy person-scope ask или роль без текущего носителя). Подбирает
 * стилистически нейтральные формулировки, чтобы шаблон не «протекал»
 * пустотами в LLM.
 *
 * Экспортируются, т.к. подстановка имён переехала в user-блок
 * `── КЛОН ДОЛЖНОСТИ ──` (см. `CLONE_RESPOND_USER_TEMPLATE`).
 */
export const CLONE_RESPOND_DEFAULT_ROLE_NAME = 'сотрудника';
export const CLONE_RESPOND_DEFAULT_BEARER_NAME = 'текущий носитель этой роли';

/**
 * Возвращает СТАБИЛЬНЫЙ системный промпт для clone-respond по режиму `mode`.
 *
 * F1 cache-friendly (мастер-промпт-флот 2026-06-10, Кластер 7-B/A8): SYSTEM
 * больше НЕ содержит переменных (`roleName` / `bearerName` / `personaPrompt`) —
 * они переехали в user-сообщение (`CLONE_RESPOND_USER_TEMPLATE`: блоки
 * `── КЛОН ДОЛЖНОСТИ ──` и `── PERSONA PROMPT ──`). Это держит SYSTEM-префикс
 * стабильным → prompt-cache hit ≈99% (см. feedback
 * `LLM-промпты — обязательно cache-friendly`).
 *
 * Используется `ClonesService.callCloneRespond` (и любыми другими местами,
 * где нужно вызвать clone-respond — например, conversational-каналом).
 *
 * ТЗ 2026-05-25 §9.4.5 (Фаза 7) — аргумент `mode`.
 *   - `mode='factual'` (default) — фактический режим (BASE).
 *   - `mode='judgmental'` — рассуждающий режим (JUDGMENTAL).
 */
export function buildCloneRespondSystemPrompt(args?: {
  mode?: 'factual' | 'judgmental';
}): string {
  return args?.mode === 'judgmental'
    ? CLONE_RESPOND_SYSTEM_PROMPT_JUDGMENTAL
    : CLONE_RESPOND_SYSTEM_PROMPT_FACTUAL;
}

/**
 * Agents v2 Фаза C1 (2026-05-30) — практический навык, подмешиваемый в
 * clone-respond. Это «известная роли процедура», на которую клон может
 * сослаться при ответе.
 */
export interface CloneRespondPracticeSkill {
  trigger: string;
  steps: ReadonlyArray<{
    order: number;
    action: string;
    emotionalRegister?: string | null;
  }>;
  redFlags: ReadonlyArray<string>;
}

export const CLONE_RESPOND_USER_TEMPLATE = (args: {
  question: string;
  /**
   * F1 cache-friendly — переменные данные клона едут в user (не в SYSTEM).
   * `roleName` / `bearerName` / `personaPrompt` опциональны: если не переданы,
   * блоки `── КЛОН ДОЛЖНОСТИ ──` / `── PERSONA PROMPT ──` собираются с
   * безопасными дефолтами (обратная совместимость со снапшот-тестами,
   * которые вызывают шаблон только с question+subgraph).
   */
  roleName?: string | null;
  bearerName?: string | null;
  personaPrompt?: string | null;
  subgraph: {
    reasoningBlocks: ReadonlyArray<{ id: string; text: string }>;
    knowledgeProfileSummary: string | null;
    decisions: ReadonlyArray<{ id: string; statement: string; rationale: string | null }>;
  };
  /**
   * Agents v2 Фаза C1 — найденные через retrieval выполняемые навыки. Если
   * массив пустой или undefined — секция `<known_procedures>` не добавляется.
   */
  practiceSkills?: ReadonlyArray<CloneRespondPracticeSkill>;
}): string => {
  const roleName =
    args.roleName && args.roleName.trim().length > 0
      ? args.roleName.trim()
      : CLONE_RESPOND_DEFAULT_ROLE_NAME;
  const bearerName =
    args.bearerName && args.bearerName.trim().length > 0
      ? args.bearerName.trim()
      : CLONE_RESPOND_DEFAULT_BEARER_NAME;
  const personaPrompt =
    args.personaPrompt && args.personaPrompt.trim().length > 0
      ? args.personaPrompt.trim()
      : '(persona-prompt не задан)';
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
  const skillsBlock =
    args.practiceSkills && args.practiceSkills.length > 0
      ? [
          '',
          'Известные процедуры роли (применяй, если триггер совпадает с темой вопроса):',
          '<known_procedures>',
          ...args.practiceSkills.flatMap((s) => {
            const stepLines = s.steps.map((st) => {
              const reg = st.emotionalRegister
                ? ` (эмоционально: ${st.emotionalRegister})`
                : '';
              return `    ${st.order}. ${st.action}${reg}`;
            });
            const flags =
              s.redFlags.length > 0
                ? [`  Чего НЕ делать: ${s.redFlags.join('; ')}`]
                : [];
            return [
              `  Когда: ${s.trigger}`,
              '  Шаги:',
              ...stepLines,
              ...flags,
              '',
            ];
          }),
          '</known_procedures>',
        ].join('\n')
      : '';
  const parts = [
    '── КЛОН ДОЛЖНОСТИ ──',
    `Должность (роль): ${roleName}`,
    `Текущий носитель должности: ${bearerName}`,
    '',
    '── PERSONA PROMPT ──',
    personaPrompt,
    '',
    'Контекст из памяти роли (накопленный опыт текущего носителя):',
    '',
    'Reasoning-блоки (объяснения «почему так решили»):',
    reasoningLines,
    '',
    'Профиль знаний роли (что носитель знает / опыт):',
    `  ${args.subgraph.knowledgeProfileSummary ?? '(пусто)'}`,
    '',
    'Недавние решения на этой должности:',
    decisionLines,
  ];
  if (skillsBlock) parts.push(skillsBlock);
  parts.push('', `── ВОПРОС ──`, args.question, '', 'Ответь от лица должности. Цитируй контекст в формате [BLOCK:id]. Если ответа нет — честно скажи.');
  return parts.join('\n');
};

export const CLONE_RESPOND_PROMPT_NAME = 'clone_respond_v2';
