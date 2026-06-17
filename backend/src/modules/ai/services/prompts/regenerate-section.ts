export const REGENERATE_SECTION_TASK_TYPE = 'regenerate-section';

export const REGENERATE_SECTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    value: {
      description: 'Новое значение секции (любого JSON-типа)',
    },
  },
  required: ['value'],
  additionalProperties: false,
};

export interface RegenerateSectionPromptInput {
  meeting: { id: string; type: string; title: string };
  sectionKey: string;
  currentValue: unknown;
  mergedTranscriptText: string;
  otherSections?: Record<string, unknown>;
  userInstruction?: string;
}

const REGENERATE_SECTION_SYSTEM = `Ты — деловой ассистент. Перегенерируй ОДНУ секцию AI-отчёта по встрече.

Правила:
- Меняй только указанную секцию. Не трогай остальные.
- Опирайся на исходный транскрипт и контекст соседних секций для согласованности.
- Учти инструкцию пользователя, если она есть.
- Формат ответа: JSON-объект {"value": <новое значение>} где value — тот же тип,
  что и текущее значение секции (массив / объект / строка / число).
- ТОЛЬКО валидный JSON, без markdown-обёрток и текста до/после.`;

export function buildRegenerateSectionPrompt(input: RegenerateSectionPromptInput): {
  system: string;
  user: string;
} {
  const userParts: string[] = [
    `Тип встречи: ${input.meeting.type}`,
    `Заголовок: ${input.meeting.title}`,
    `Ключ секции для регенерации: "${input.sectionKey}"`,
    '',
    'Текущее значение секции (нужно улучшить/перегенерировать):',
    safeStringify(input.currentValue),
  ];
  if (input.otherSections) {
    userParts.push(
      '',
      'Соседние секции (для контекста, НЕ менять):',
      safeStringify(input.otherSections),
    );
  }
  if (input.userInstruction) {
    userParts.push('', 'Инструкция пользователя:', input.userInstruction);
  }
  userParts.push('', 'Транскрипт встречи:', input.mergedTranscriptText);
  userParts.push(
    '',
    'Верни JSON-объект {"value": <новое значение>}. Если provider не поддерживает strict JSON Schema — всё равно отвечай ТОЛЬКО валидным JSON без markdown.',
  );
  return {
    system: REGENERATE_SECTION_SYSTEM,
    user: userParts.join('\n'),
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
