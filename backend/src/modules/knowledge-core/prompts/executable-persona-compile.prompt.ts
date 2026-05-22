/**
 * SBA γ-1 — Specialist 3.7 (ExecutablePersona).
 *
 * LLM-промпт `executable-persona-compile` — собирает текстовый persona prompt
 * («Думай как X. Тебя характеризует …») из списка активных SkillTrait'ов.
 * Используется ClonesService как system prompt для clone-respond.
 *
 * Контракт:
 *   - Длина результата 300–800 слов.
 *   - Структура: представление + 3–7 ключевых черт + общий подход.
 *   - Формулировки — от первого лица («я обычно …»/«мне важно …»).
 *   - НЕ выдумывать черты, которых нет в input'е.
 *
 * TODO(owner-product): согласовать финальный текст промпта + длину.
 */

export const EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер. Тебе дают набор наблюдённых черт рабочего поведения сотрудника. Собери из них persona-prompt от первого лица — короткое описание подхода, которое можно подмешать в system-prompt LLM для имитации стиля размышления этого сотрудника.',
  '',
  'Структура результата:',
  '1. Представление в 1–2 предложениях (имя, роль если есть).',
  '2. 3–7 ключевых черт подхода — каждая в 1–2 предложениях, от первого лица.',
  '3. Общий принцип / приоритет («больше всего я обращаю внимание на …»).',
  '',
  'Правила:',
  '- Формулировки — от первого лица («я обычно …»/«мне важно …»).',
  '- Гипотезный тон сохраняется: «обычно», «как правило», «в большинстве случаев».',
  '- Длина — 300–800 слов.',
  '- НЕ выдумывать черты, которых нет в input traits.',
  '- НЕ использовать персональные данные (возраст, национальность, состояние здоровья).',
  '- Результат — обычный текст (НЕ markdown, НЕ JSON). Только prose.',
].join('\n');

export const EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE = (args: {
  personName: string;
  personRole: string | null;
  traits: ReadonlyArray<{
    category: string;
    statement: string;
    confidence: string;
    observationCount: number;
  }>;
}): string => {
  const head = args.personRole
    ? `Сотрудник: ${args.personName} (${args.personRole}).`
    : `Сотрудник: ${args.personName}.`;
  const traitLines = args.traits.length
    ? args.traits
        .map(
          (t, i) =>
            `  ${i + 1}. [${t.confidence}, ${t.observationCount} наблюдений] «${t.category}»: ${t.statement}`,
        )
        .join('\n')
    : '  (черт нет)';
  return [
    head,
    `Активные черты профиля (${args.traits.length}):`,
    traitLines,
    '',
    'Собери persona-prompt от первого лица по правилам выше. Верни только обычный текст без markdown.',
  ].join('\n');
};

/**
 * Формат — plain text (НЕ JSON). LlmRouterService.call без responseFormat.
 */
export const EXECUTABLE_PERSONA_COMPILE_PROMPT_NAME = 'executable_persona_compile_v1';
