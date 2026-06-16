import { withInjectionGuard, wrapUserData } from './common';

export const DOC_TYPE_CATALOG: ReadonlyArray<string> = [
  '`regulation` — регламент: обязательные правила/нормы выполнения работы.',
  '`policy` — политика: принципы и рамки (что можно/нельзя), без пошаговости.',
  '`instruction` — инструкция: пошаговое руководство «как сделать X».',
  '`process` — описание процесса: последовательность этапов с входами/выходами.',
  '`job_description` — должностная инструкция: обязанности и зона ответственности роли.',
  '`other` — прочее: не подходит ни под один тип выше.',
];

export interface AttributionThemeOption {
  id: string;
  name: string;
}

export interface BuildDocumentAttributionPromptArgs {
  textExcerpt: string;
  themes: ReadonlyArray<AttributionThemeOption>;
}

function buildSystem(): string {
  const typeLines = DOC_TYPE_CATALOG.map((l) => `  - ${l}`).join('\n');

  return withInjectionGuard(
    [
      'Ты классифицируешь загруженный в память компании документ. Тебе дают фрагмент текста документа и список тем графа знаний компании (id, название). Определи смысловой тип документа и наиболее подходящую тему. Это ПОДСКАЗКА — человек её подтвердит или поправит, поэтому не выдумывай: при сомнении ставь `other` и/или `themeId: null` и понижай confidence.',
      '',
      '## Каталог смысловых типов документа (выбери ровно один)',
      typeLines,
      '',
      '## Жёсткие правила',
      '- `docType` — ТОЛЬКО одно из значений каталога выше. Никогда не выдумывай новые типы.',
      '- `themeId` бери ТОЛЬКО из переданного списка тем (по полю id). Если ни одна тема не подходит или список тем пуст — верни `themeId: null`. Никогда не выдумывай id.',
      '- `confidence` — число от 0 до 1 (твоя уверенность в `docType`). При явном совпадении ~0.85+, при догадке ~0.4-0.6, при отсутствии сигнала ≤0.3.',
      '- Опирайся ТОЛЬКО на переданный текст и список тем. Не используй внешние знания.',
      '- Не добавляй пояснений и текста вокруг JSON.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "docType": "regulation|policy|instruction|process|job_description|other", "themeId": string|null, "confidence": number }`',
    ].join('\n'),
  );
}

const SYSTEM = buildSystem();

export function buildDocumentAttributionPrompt(args: BuildDocumentAttributionPromptArgs): {
  system: string;
  user: string;
} {
  const themeLines = args.themes.map((t) => `  - id=${t.id} | «${t.name}»`).join('\n');

  const user = [
    'Темы графа знаний компании (выбирай themeId ТОЛЬКО отсюда):',
    themeLines || '  (тем нет — верни themeId: null)',
    '',
    'Фрагмент текста документа:',
    wrapUserData(args.textExcerpt.trim()),
    '',
    'Верни JSON-подсказку атрибуции по правилам из системного сообщения.',
  ].join('\n');

  return { system: SYSTEM, user };
}
