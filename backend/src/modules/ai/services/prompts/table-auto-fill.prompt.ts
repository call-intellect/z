import { withInjectionGuard, wrapUserData } from './common';

export interface AutoFillPropertyDescriptor {
  id: string;
  name: string;
  type: string;
  hint?: string;
}

export interface BuildTableAutoFillPromptArgs {
  property: AutoFillPropertyDescriptor;
  rowContext: string;
  transcriptChunk: string;
}

function buildSystem(): string {
  return withInjectionGuard(
    [
      'Ты подбираешь значение для ОДНОЙ ячейки таблицы СТРОГО из транскрипта встречи. Тебе дают описание колонки, контекст строки (уже известные значения) и фрагмент транскрипта. Верни значение колонки только если факт ПРЯМО назван в транскрипте.',
      '',
      '## Жёсткие правила',
      '- Если факт прямо не назван в транскрипте или ты не уверен — верни `value: null`. Лучше null, чем выдумка.',
      '- Никогда не додумывай и не выводи значение «по смыслу» — только то, что явно сказано.',
      '- Формат value соответствует типу колонки: число для number/currency/percent; ГГГГ-ММ-ДД для date; true/false для checkbox; строка для text/longtext/url/email/phone; одно из допустимых значений для status/selectSingle; массив для selectMulti.',
      '- `confidence` (0..1) — насколько явно факт назван. При `value: null` верни `confidence: 0`.',
      '- `quote` — короткая дословная цитата-подтверждение (пустая строка при null).',
      '- `timeSec` — секунда начала реплики-источника, если известна; иначе 0.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "value": string|number|boolean|array|null, "confidence": number, "quote": string, "timeSec": number }`',
    ].join('\n'),
  );
}

const SYSTEM = buildSystem();

export function buildTableAutoFillPrompt(args: BuildTableAutoFillPromptArgs): {
  system: string;
  user: string;
} {
  const p = args.property;
  const user = [
    `Колонка: id=${p.id} | «${p.name}» | тип ${p.type}${p.hint ? ` | ${p.hint}` : ''}`,
    '',
    'Контекст строки (уже известные значения):',
    args.rowContext.trim() || '  (пусто)',
    '',
    'Фрагмент транскрипта встречи:',
    wrapUserData(args.transcriptChunk.trim()),
    '',
    'Верни JSON по правилам из системного сообщения. Если факт не назван прямо — value: null.',
  ].join('\n');

  return { system: SYSTEM, user };
}
