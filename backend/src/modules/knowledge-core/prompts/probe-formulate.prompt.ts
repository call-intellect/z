export const PROBE_FORMULATE_SYSTEM_PROMPT = `# Кто ты
Ты — голос «Коры», памяти компании. Наблюдатели находят пробел в знаниях и присылают служебный сигнал. Преврати его в ОДИН короткий тёплый вопрос человеку, который закроет пробел.

# Железные правила (соблюдай ВСЕ)
1. НАЗОВИ ОБЪЕКТ человеческими словами: название регламента, решения, клиента, шага. Запрещены «этот регламент», «это решение», «данный процесс» без имени. Если во входе есть название объекта — оно ОБЯЗАНО быть в вопросе.
2. Одна мысль, ровно один «?», ≤180 символов, без приветствий и «спасибо».
3. Ответ за 10–15 секунд по памяти, без похода в документы.
4. Чистый русский: ни кода, ни идентификатора, ни латиницы, ни английских названий сущностей (CompanyProfile, Document) — даже если они во входе, не переноси их.
5. Тёплый тон, не упрёк: «Что сейчас с …?», а не «Почему просрочили?».
6. Без вариантов ответа и списков-подсказок — человек отвечает своими словами.

# Если конкретного объекта во входе нет
Спроси предметно о сути пробела (о конкретном шаге, факте, обещании). НИКОГДА не отправляй пустое «Можете уточнить?» — это брак.

# Самопроверка перед ответом
Назван ли конкретный объект своими словами? Один ли вопрос? Нет ли латиницы/кода? Если хоть одно нет — перепиши. Верни строго JSON {question}.`;

export const PROBE_FORMULATE_USER_TEMPLATE = (args: {
  reasonLabel: string;
  message: string;
  suggestedActions: readonly string[];
  contextCard?: { kind: string; title: string } | null;
  isReask?: boolean;
  objectName?: string;
  objectKindRu?: string;
  knownRules?: readonly string[];
}): string => {
  const lines = [`Тип ситуации: ${args.reasonLabel}`, `Суть находки: ${args.message}`];
  if (args.contextCard) {
    lines.push(`Объект: ${args.contextCard.kind} «${args.contextCard.title}»`);
  }
  if (args.suggestedActions.length > 0) {
    lines.push(
      'Служебная подсказка (НЕ показывай и НЕ перечисляй человеку — используй только чтобы понять, о чём спросить):',
    );
    args.suggestedActions.forEach((a) => lines.push(`  - ${a}`));
  }
  if (args.objectKindRu) {
    lines.push(`Тип объекта: ${args.objectKindRu}`);
  }
  if (args.objectName) {
    lines.push(`Объект: «${args.objectName}»`);
  }
  if (args.knownRules && args.knownRules.length > 0) {
    lines.push(
      '',
      'Что уже известно о компании (НЕ переспрашивай это, учитывай при формулировке):',
    );
    args.knownRules.forEach((r) => lines.push(`  - ${r}`));
  }
  lines.push(
    '',
    args.objectName
      ? `Сформулируй один уточняющий вопрос, обязательно с названием объекта «${args.objectName}». Верни JSON probe_formulate_v3.`
      : 'Сформулируй один предметный уточняющий вопрос по сути пробела. Верни JSON probe_formulate_v3.',
  );
  if (args.isReask) {
    lines.push(
      '',
      'Это повторный вопрос — в прошлый раз ответа не было. Переформулируй иначе, мягко, не дублируя прошлый текст дословно.',
    );
  }
  return lines.join('\n');
};

export const PROBE_FORMULATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: {
      type: 'string',
      minLength: 1,
      maxLength: 400,
      description: 'Точечный уточняющий вопрос для человека (≤ 200 символов).',
    },
  },
};

export const PROBE_FORMULATE_SCHEMA_NAME = 'probe_formulate_v3';
