import { withInjectionGuard, wrapUserData } from './common';

const COLUMN_TYPE_CATALOG: ReadonlyArray<[type: string, ru: string]> = [
  ['text', 'короткая строка (имя, название)'],
  ['longtext', 'длинный текст / заметка'],
  ['number', 'число'],
  ['currency', 'денежная сумма'],
  ['percent', 'процент'],
  ['date', 'дата'],
  ['status', 'статус из фиксированного набора (один из, с цветами)'],
  ['selectSingle', 'выбор одного значения из набора'],
  ['selectMulti', 'выбор нескольких значений из набора'],
  ['checkbox', 'да/нет (галочка)'],
  ['person', 'сотрудник / человек'],
  ['url', 'ссылка (адрес сайта)'],
  ['email', 'электронная почта'],
  ['phone', 'телефон'],
  ['file', 'файл / вложение'],
  ['formula', 'вычисляемое поле (формула)'],
  ['relation', 'связь со строкой другой таблицы'],
  ['rollup', 'агрегат по связанным строкам'],
];

const ENTITY_SYNC_CATALOG: ReadonlyArray<[type: string, ru: string]> = [
  ['org', 'организация / клиент / поставщик (внешняя компания)'],
  ['person', 'человек / сотрудник'],
  ['meeting', 'встреча'],
  ['document', 'документ'],
];

export interface BuildTableInferSchemaPromptArgs {
  userPrompt: string;
  availableSyncTypes: ReadonlyArray<'org' | 'person' | 'meeting' | 'document'>;
  catalogColumnTypes?: ReadonlyArray<[type: string, ru: string]>;
  systemTableExamples: ReadonlyArray<{
    systemKey: string;
    name: string;
    icon: string;
  }>;
}

function buildSystem(args: {
  catalogColumnTypes: ReadonlyArray<[type: string, ru: string]>;
  systemTableExamples: ReadonlyArray<{
    systemKey: string;
    name: string;
    icon: string;
  }>;
}): string {
  const typeLines = args.catalogColumnTypes.map(([t, ru]) => `  - \`${t}\` — ${ru}`).join('\n');
  const entityLines = ENTITY_SYNC_CATALOG.map(([t, ru]) => `  - \`${t}\` — ${ru}`).join('\n');
  const exampleLines = args.systemTableExamples
    .map((e) => `  - ${e.icon} «${e.name}» (${e.systemKey})`)
    .join('\n');

  return withInjectionGuard(
    [
      'Ты проектируешь схему таблицы для системы памяти компании «Кора». По короткому описанию пользователя ты предлагаешь структуру таблицы: название, иконку-эмодзи, краткое описание и набор колонок. Отвечай только на русском, без англицизмов в пользовательских строках.',
      '',
      '## Допустимые типы колонок (поле `type`)',
      'Используй ТОЛЬКО эти значения. Любой другой тип запрещён.',
      typeLines,
      '',
      '## Привязка к графу знаний (поле `entitySync`)',
      'Если таблица по смыслу описывает сущность графа знаний — укажи `entitySync: { "type": "<тип>" }`. Иначе верни `entitySync: null`. Допустимые типы:',
      entityLines,
      'Примеры: «клиенты»/«поставщики» → org; «команда»/«сотрудники» → person; «встречи» → meeting; «документы» → document. Если таблица не про эти сущности (задачи, бюджет, оборудование и т.п.) — null.',
      '',
      '## Эталоны стиля (системные таблицы Коры)',
      'Ориентируйся на их тон именования колонок и иконки:',
      exampleLines,
      '',
      '## Правила вывода',
      '- Верни СТРОГО валидный JSON-объект, без markdown-обёрток и комментариев.',
      '- Форма: `{ "name": string, "description": string|null, "icon": string|null, "entitySync": { "type": string } | null, "properties": [ { "name": string, "type": string, "isPrimary": boolean, "config"?: object } ] }`.',
      '- `name` — короткое название таблицы (1-3 слова), не пустое.',
      '- `icon` — один эмодзи, подходящий по смыслу.',
      '- `properties` — от 3 до 12 колонок. Ровно ОДНА колонка с `isPrimary: true` — это именующая колонка (обычно первая, тип `text`).',
      '- Для типов `status` / `selectSingle` / `selectMulti` добавь `config: { "options": [ { "id": "opt-1", "name": "...", "color": "info" } ] }`. Цвет — один из: success, warning, danger, info, neutral. Для остальных типов `config` не нужен.',
      '- Не добавляй системные колонки (дата создания, автор) — их система добавит сама.',
      '- Названия колонок — на русском, человеческие («Сумма», «Ответственный», «Стадия»).',
    ].join('\n'),
  );
}

export function buildTableInferSchemaPrompt(args: BuildTableInferSchemaPromptArgs): {
  system: string;
  user: string;
} {
  const catalog = args.catalogColumnTypes ?? COLUMN_TYPE_CATALOG;
  const system = buildSystem({
    catalogColumnTypes: catalog,
    systemTableExamples: args.systemTableExamples,
  });
  const user = [
    `Доступные типы привязки к графу (entitySync): ${args.availableSyncTypes.join(', ') || '(нет)'}.`,
    '',
    'Запрос пользователя:',
    wrapUserData(args.userPrompt.trim()),
    '',
    'Верни JSON-объект схемы таблицы по правилам из системного сообщения.',
  ].join('\n');
  return { system, user };
}

export const TABLE_INFER_SCHEMA_DEFAULT_COLUMN_CATALOG = COLUMN_TYPE_CATALOG;
