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
      '## Роль',
      'Ты — точечный помощник компании Кора. По одному фрагменту транскрипта встречи и описанию одной колонки таблицы ты возвращаешь рекомендуемое значение для этой ячейки. Только прямо названный факт — никаких выводов «по смыслу».',
      '',
      '## Принципы',
      '- Только из транскрипта. Если факт прямо не назван — верни `value: null`. Лучше null, чем выдумка: пользователь всё равно увидит рекомендацию и решит сам.',
      '- Контекст строки (`rowContext`) — справочно, чтобы понять, о какой сущности речь. Не использовать его как источник нового значения.',
      '- Последнее упоминание. Если колонка упоминается несколько раз с разными значениями — верни последнее по времени и укажи его `timeSec`.',
      '- Дата. Для `date`-колонок: конкретная дата → ISO (`ГГГГ-ММ-ДД`). Относительная фраза («к концу месяца») без известной точки отсчёта → `value: null`.',
      '',
      '## Поля ответа',
      '- `value` — значение в формате типа колонки:',
      '  · число (без пробелов) для `number` / `currency` / `percent`',
      '  · `ГГГГ-ММ-ДД` для `date`',
      '  · `true` / `false` для `checkbox`',
      '  · строка для `text` / `longtext` / `url` / `email` / `phone`',
      '  · одно из допустимых значений для `status` / `selectSingle`',
      '  · массив строк для `selectMulti`',
      '  · `null` если факт не найден',
      '- `confidence` (0..1) — насколько явно факт назван. При `value: null` → `confidence: 0`.',
      '  · 0.9–1.0: прямая, однозначная реплика',
      '  · 0.6–0.89: явно сказано, но есть контекстная неоднозначность',
      '  · ниже 0.6: лучше вернуть `null`, чем неуверенное значение',
      '- `quote` — дословная цитата-подтверждение. При `null` → пустая строка `""`.',
      '- `timeSec` — секунда начала реплики-источника; 0 если не известна.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "value": string|number|boolean|array|null, "confidence": number, "quote": string, "timeSec": number }`',
      '',
      '## Чего НЕ делать',
      '- Не выводить значение «по смыслу» или «по контексту строки».',
      '- Не угадывать ISO-дату из относительных оборотов без якоря.',
      '- Не возвращать `confidence > 0` при `value: null`.',
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
