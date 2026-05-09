/**
 * Промпт для регенерации одной секции AI-отчёта.
 *
 * `sectionKey` — ключ внутри `AiResult.structuredData` (зависит от типа встречи:
 * например, для sales — "objections", "next_steps"; для standup — "blockers"
 * и т.п.). Рендерит prompt'ом, который инструктирует модель пересгенерировать
 * только эту секцию, опираясь на оригинальный transcript и текущие значения
 * других секций (для согласованности).
 */
export const REGENERATE_SECTION_TASK_TYPE = 'regenerate-section';
export const REGENERATE_SECTION_PROMPT_NAME = 'regenerate_section_v1';

export interface RegenerateSectionPromptInput {
  meeting: { id: string; type: string; title: string };
  sectionKey: string;
  /** Текущее значение секции (то, что хочет улучшить пользователь). */
  currentValue: unknown;
  /** Полный merged-transcript встречи (если поместится в контекст). */
  mergedTranscriptText: string;
  /** Соседние секции — для контекста, чтобы новая не противоречила. */
  otherSections?: Record<string, unknown>;
  /** Опц. инструкция от пользователя («сделай короче», «добавь блокеров» и т.п.). */
  userInstruction?: string;
}

const REGENERATE_SECTION_SYSTEM = `Ты — деловой ассистент. Перегенерируй ОДНУ секцию AI-отчёта по встрече.

Правила:
- Меняй только указанную секцию. Не трогай остальные.
- Опирайся на исходный транскрипт и контекст соседних секций для согласованности.
- Учти инструкцию пользователя, если она есть.
- Формат ответа: JSON с тем же типом, что и текущее значение секции.
  Если секция — массив, верни массив. Если объект — объект. Если строка — строку.
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
  userParts.push('', 'Reply with valid JSON only — только новое значение секции.');
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
