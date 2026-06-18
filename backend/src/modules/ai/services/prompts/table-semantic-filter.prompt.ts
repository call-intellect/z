import { withInjectionGuard, wrapUserData } from './common';

export interface SemanticFilterColumn {
  id: string;
  name: string;
  type: string;
}

export interface BuildTableSemanticFilterPromptArgs {
  properties: ReadonlyArray<SemanticFilterColumn>;
  nlQuery: string;
  today: string;
}

const OPERATOR_CATALOG: ReadonlyArray<string> = [
  '`eq` — равно. Для любого типа. value — искомое значение.',
  '`neq` — не равно. Для любого типа. value — значение.',
  '`contains` — подстрока (без учёта регистра). Только text/longtext/email/phone/url. value — строка.',
  '`gt` — больше. Только number/currency/percent/date. value — число (или ISO-дата для date-колонок).',
  '`lt` — меньше. Только number/currency/percent/date. value — число (или ISO-дата для date-колонок).',
  '`before` — дата строго раньше заданной. Только date. value — ISO-дата `ГГГГ-ММ-ДД`.',
  '`after` — дата строго позже заданной. Только date. value — ISO-дата `ГГГГ-ММ-ДД`.',
  '`older_than` — значение-дата старше, чем N дней назад от сегодняшней даты. Только date. value — число дней (например 30 для «месяц назад»).',
  '`in` — значение входит в набор. Только selectSingle/selectMulti/status/person. value — массив строк.',
  '`empty` — ячейка пуста. Для любого типа. value НЕ нужен.',
];

function buildSystem(): string {
  const opLines = OPERATOR_CATALOG.map((l) => `  - ${l}`).join('\n');

  return withInjectionGuard(
    [
      'Ты конвертируешь запрос пользователя в JSON-фильтр для таблицы. Тебе дают список колонок текущей таблицы (id, название, тип), сегодняшнюю дату и сам запрос на естественном языке. Твоя задача — вернуть набор условий фильтра, которые отбирают строки, соответствующие запросу.',
      '',
      '## Каталог операторов (используй ТОЛЬКО их)',
      opLines,
      '',
      '## Жёсткие правила',
      '- `propertyId` бери ТОЛЬКО из переданного списка колонок. Никогда не выдумывай id и не ссылайся на несуществующие колонки.',
      '- Используй ТОЛЬКО операторы из каталога и ТОЛЬКО на совместимых типах колонок (см. «где применим»).',
      '- Запросы вида «кому давно/месяц/N дней никто не писал», «нет активности N дней» по колонке-дате последнего контакта → оператор `older_than` с value = число дней (месяц ≈ 30, неделя ≈ 7).',
      '- Относительные даты («с начала года», «после 1 мая») переводи в ISO-дату `ГГГГ-ММ-ДД` относительно переданной сегодняшней даты и используй before/after.',
      '- Если запрос НЕ про фильтрацию строк (приветствие, вопрос не по данным, бессмыслица) — верни пустой массив `{ "filters": [] }`. Не выдумывай условия.',
      '- Не добавляй пояснений и текста вокруг JSON.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "filters": [ { "propertyId": string, "op": string, "value"?: string|number|array } ] }`',
    ].join('\n'),
  );
}

const SYSTEM = buildSystem();

export function buildTableSemanticFilterPrompt(args: BuildTableSemanticFilterPromptArgs): {
  system: string;
  user: string;
} {
  const colLines = args.properties
    .map((p) => `  - id=${p.id} | «${p.name}» | тип ${p.type}`)
    .join('\n');

  const user = [
    `Сегодняшняя дата (точка отсчёта для older_than/before/after): ${args.today}`,
    '',
    'Колонки текущей таблицы:',
    colLines || '  (нет колонок)',
    '',
    'Запрос пользователя:',
    wrapUserData(args.nlQuery.trim()),
    '',
    'Верни JSON-фильтр по правилам из системного сообщения.',
  ].join('\n');

  return { system: SYSTEM, user };
}
