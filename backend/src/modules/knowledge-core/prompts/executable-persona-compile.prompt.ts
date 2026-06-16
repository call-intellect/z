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
  '- НЕ использовать персональные данные (возраст, национальность, состояние здоровья).',
  '- Формат: связный текст без структуры (НЕ markdown, НЕ JSON, НЕ списки) — обычные абзацы',
  '  от первого лица.',
  '- НЕ добавляй traits, которых нет в input. Если в input 3 черты — собери persona по ним 3,',
  '  не расширяй до 5.',
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

export const EXECUTABLE_PERSONA_COMPILE_PROMPT_NAME = 'executable_persona_compile_v1';

export type PersonaCompileTraitInput = {
  category: string;
  statement: string;
  confidence: string;
  observationCount: number;
};

export type PersonaCompilePrincipleInput = {
  situation: string;
  statement: string;
  observationCount: number;
  confidence: string;
};

export type PersonaCompilePracticeSkillInput = {
  trigger: string;
  steps: ReadonlyArray<{ order: number; action: string }>;
  redFlags: ReadonlyArray<string>;
};

export const EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер. Тебе дают наблюдённые слои рабочего метода сотрудника или роли: черты подхода, ценности из проявленных выборов, мотивацию, принципы решений роли, типовые процедуры и маркеры процесса. Собери из них persona-prompt от первого лица — описание рабочего метода, которое можно подмешать в prompt LLM для имитации стиля размышления этого сотрудника или роли. Этот текст и ЕСТЬ клон должности: его подмешивают в ответ клона, и от его лица клон отвечает реальным коллегам. Поэтому каждая строка должна быть проверяемым ходом процесса из входных слоёв, а не красивым самоописанием — иначе клон будет звучать убедительно, но врать о методе роли.',
  '',
  'Структура результата — до 5 секций, строго в этом порядке. Секция опускается ЦЕЛИКОМ, если соответствующий блок во входе пуст или отсутствует:',
  '1. «Мой подход к решениям» — из блока «Черты подхода»: как я обычно думаю и действую, когда принимаю решения.',
  '2. «Что я ставлю выше при конфликте приоритетов» — из блоков «Ценности из проявленных выборов» и «Мотивация в работе»: что я выбираю, когда приоритеты сталкиваются, и что меня драйвит в работе.',
  '3. «Мои принципы в типовых ситуациях» — из блока «Принципы роли»: формат «в ситуации X мой типовой ход — Y».',
  '4. «Типовые ситуации → как я действую» — из блока «Процедуры»: когда срабатывает триггер — какие шаги я делаю по порядку и чего при этом не делаю.',
  '5. «Как я веду процесс» — из блока «Маркеры процесса»: например «обычно перед рекомендацией я перечисляю варианты и критерий выбора».',
  '',
  'ГЛАВНЫЙ ИНВАРИАНТ (Personality Illusion): каждая строка результата — поведенческое ПРАВИЛО ПРОЦЕССА с конкретным якорем («обычно я сначала …, потом …»), а НЕ ярлык («я рациональный», «я перфекционист») и НЕ самоописание характера. Если формулировку нельзя переписать как наблюдаемый ход действий — выброси её.',
  '',
  'Правила:',
  '- Формулировки — от первого лица («я обычно …»/«мне важно …»).',
  '- Гипотезный тон: «обычно», «как правило», «в большинстве случаев».',
  '- НЕ выдумывать: используй только то, что есть во входе. Если в блоке 3 элемента — собери секцию по этим 3, не расширяй.',
  '- Пустые секции пропускай молча: НЕ добавляй заголовков для пустых секций, НЕ пиши «(нет данных)».',
  '- Формат: связный текст с короткими заголовками секций; заголовок — просто строка БЕЗ markdown-разметки («#», «**»), НЕ JSON.',
  '- НЕ использовать персональные данные (возраст, национальность, состояние здоровья).',
  '- Длина — 300–1200 слов.',
  '',
  'ОБРАЗЕЦ (как должно звучать — правило процесса с якорем, от первого лица):',
  'Мой подход к решениям',
  'Я обычно не фиксирую срок, пока не увижу фактические данные — замеры нагрузки, метрики прошлого периода: на оценках без цифр я обжигался, поэтому как правило прошу замеры перед коммитом.',
  'Мои принципы в типовых ситуациях',
  'В ситуации срыва срока мой типовой ход — сначала прихожу к владельцу с двумя вариантами (резать scope или двигать дату) и только после решения режу функционал.',
  '',
  'ТАК НЕ НАДО (ярлыки без хода действий): «Я рациональный и ответственный, всегда довожу начатое до конца, стремлюсь к качеству.» — это самоописание характера, а не метод.',
  '',
  'ПЕРЕД ВЫДАЧЕЙ проверь: каждая строка — наблюдаемый ход процесса с якорем (а не ярлык характера); использованы только слои из входа (ничего не выдумано); пустые секции опущены без заголовков; всё от первого лица; 300–1200 слов. Если строку нельзя переписать как ход действий — выброси её.',
].join('\n');

export const EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE = (args: {
  personName: string;
  personRole: string | null;
  traits: ReadonlyArray<PersonaCompileTraitInput>;
  values: ReadonlyArray<PersonaCompileTraitInput>;
  motivations: ReadonlyArray<PersonaCompileTraitInput>;
  principles: ReadonlyArray<PersonaCompilePrincipleInput>;
  practiceSkills: ReadonlyArray<PersonaCompilePracticeSkillInput>;
  processMarkers: ReadonlyArray<PersonaCompileTraitInput>;
}): string => {
  const head = args.personRole
    ? `Сотрудник: ${args.personName} (${args.personRole}).`
    : `Сотрудник: ${args.personName}.`;

  const traitLine = (t: PersonaCompileTraitInput, i: number): string =>
    `  ${i + 1}. [${t.confidence}, ${t.observationCount} наблюдений] «${t.category}»: ${t.statement}`;

  const blocks: string[] = [];

  if (args.traits.length > 0) {
    blocks.push(
      [`Черты подхода (${args.traits.length}):`, ...args.traits.map(traitLine)].join('\n'),
    );
  }

  if (args.values.length > 0) {
    blocks.push(
      [
        `Ценности из проявленных выборов (${args.values.length}):`,
        ...args.values.map(traitLine),
      ].join('\n'),
    );
  }

  if (args.motivations.length > 0) {
    blocks.push(
      [`Мотивация в работе (${args.motivations.length}):`, ...args.motivations.map(traitLine)].join(
        '\n',
      ),
    );
  }

  if (args.principles.length > 0) {
    blocks.push(
      [
        `Принципы роли (${args.principles.length}):`,
        ...args.principles.map(
          (p, i) =>
            `  ${i + 1}. [${p.confidence}, ${p.observationCount} наблюдений] Ситуация «${p.situation}»: ${p.statement}`,
        ),
      ].join('\n'),
    );
  }

  if (args.practiceSkills.length > 0) {
    blocks.push(
      [
        `Процедуры (${args.practiceSkills.length}):`,
        ...args.practiceSkills.flatMap((s, i) => {
          const lines: string[] = [
            `  ${i + 1}. Когда: ${s.trigger}`,
            '     Шаги:',
            ...s.steps.map((st) => `       ${st.order}. ${st.action}`),
          ];
          if (s.redFlags.length > 0) {
            lines.push(`     Чего не делать: ${s.redFlags.join('; ')}`);
          }
          return lines;
        }),
      ].join('\n'),
    );
  }

  if (args.processMarkers.length > 0) {
    blocks.push(
      [
        `Маркеры процесса (${args.processMarkers.length}):`,
        ...args.processMarkers.map(traitLine),
      ].join('\n'),
    );
  }

  const parts: string[] = [head];
  for (const block of blocks) {
    parts.push('', block);
  }
  parts.push('', 'Собери persona-prompt от первого лица по правилам. Верни только обычный текст.');
  return parts.join('\n');
};

export const EXECUTABLE_PERSONA_COMPILE_V2_PROMPT_NAME = 'executable_persona_compile_v2';
