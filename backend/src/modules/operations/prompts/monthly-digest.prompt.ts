import { z } from 'zod';

import { tryParseJson } from '../../ai/services/json-extract.util';
import type {
  MonthlyDigestLetterSectionDto,
  MonthlyDigestVerdictDto,
  MonthWeekTrendAxisDto,
  MonthWeekTrendState,
} from '../dto/monthly-digest.dto';

export const MONTH_COMPANY_PROMPT_VERSION = 'month-company-v2';
export const MONTHLY_DIGEST_TASK_TYPE = 'operations-monthly-digest';

const MONTH_VERDICT_STATES = ['ok', 'warn', 'risk'] as const;
const MONTH_AXIS_KEYS = ['team', 'clients', 'execution', 'overall'] as const;
const MONTH_LETTER_KEYS = [
  'intro',
  'main',
  'done',
  'not_done',
  'reporting',
  'blocked',
  'clients',
  'ideas',
  'attention',
  'actions',
  'delta',
  'reflection',
] as const;
const MONTH_COMPASS_DIRECTIONS = ['to_goal', 'drift', 'against'] as const;

const MONTH_COMPANY_FEW_SHOT_JSON = JSON.stringify(
  {
    verdict: {
      overall: {
        state: 'warn',
        emoji: '⚠️',
        title: 'Месяц ушёл вправо',
        oneLiner:
          'Сергей, коротко — месяц вышел с накопленным трением: команда держит темп, но интеграция буксует четвёртую неделю и один клиент ушёл в риск.',
      },
      axes: [
        {
          key: 'team',
          state: 'warn',
          label: 'Тянут двое, дисциплина просела',
          why: 'Настроение по месяцу ровное, но вечерняя отчётность падает 3-ю неделю подряд, а спор поддержки и продаж так и не закрыт.',
        },
        {
          key: 'clients',
          state: 'risk',
          label: '«Молочные реки» на грани',
          why: 'Сигнал молчания поддержки повторялся три недели из четырёх — клиент так и не выведен из риска.',
        },
        {
          key: 'execution',
          state: 'warn',
          label: 'Интеграция буксует весь месяц',
          why: 'Блокер оплаты коннекторов всплывал во всех четырёх неделях — по цели прошли 3 теста из 10.',
        },
        {
          key: 'overall',
          state: 'warn',
          label: 'Держится на владельце',
          why: 'Повторяющийся корень месяца — критичное замкнуто на тебе: оплата, подрядчик, КП.',
        },
      ],
    },
    letter: [
      {
        key: 'intro',
        title: 'Интро',
        prose:
          'Сергей, коротко — месяц вышел ровным по команде, но тяжёлым по исполнению. Главное за четыре недели: интеграция буксует на одном и том же блокере, а «Молочные реки» так и не вышли из риска. Ниже — накопленная картина месяца, без пересказа каждой недели.',
      },
      {
        key: 'main',
        title: 'Главное за месяц',
        prose:
          'Три сюжета определили месяц. Первый — интеграция чат-бокса сдвигалась медленно: блокер оплаты коннекторов всплывал во всех четырёх неделях, по цели прошли только 3 теста из 10. Второй — «Молочные реки» держались в риске три недели из четырёх, повод один и тот же: молчание поддержки. Третий — вечерняя отчётность просела к концу месяца, и без неё месяц виден наполовину.',
      },
      {
        key: 'done',
        title: 'Что сделано',
        prose:
          'За месяц команда закрыла 62 задачи из 91 поставленной. Главное движение — запустили 3 из 10 тестов по цели, довели до продакшена вебхуки чат-бокса и подписали договор с подрядчиком. Месяц дал реальный, хоть и неровный, сдвиг по интеграции.',
      },
      {
        key: 'reporting',
        title: 'Отчётность и план ↔ факт',
        prose:
          'По месяцу утренний план сдавали стабильно, вечерний отчёт — всё хуже от недели к неделе: к четвёртой неделе отчитывалась половина команды. Марат и Лена держали дисциплину весь месяц, у Алии план расходился с фактом чаще других. Хвост без отчёта тянется тремя людьми уже третью неделю → закрепить ритуал?',
      },
      {
        key: 'blocked',
        title: 'Что помешало',
        prose:
          'Месяц тормозили три разные вещи с одним общим корнем. Главное — узкое место «всё на Сергее»: блокер оплаты, подрядчик и КП весь месяц упирались в тебя одного, это системный риск незаменимости, а не разовая задержка. Второе — инструмент: Битрикс24 не держит дисциплину задач, тема всплывала на встречах весь месяц. Третье, тише — нерешённый спор поддержки и продаж за ведение клиента после сделки, именно он стоил времени по «Молочным рекам».',
      },
      {
        key: 'attention',
        title: 'На что обратить внимание',
        prose:
          'Главный вывод месяца — bus-factor из паттерна стал нормой: четыре недели подряд критичное замыкается на тебе. Петля с прошлым месяцем: в прошлом месяце я отметила молчание поддержки как ранний клиентский риск — за этот месяц он не только не закрылся, но повторился по «Молочным рекам», сигнал вырос ⚠️ → 🔴.',
      },
      {
        key: 'actions',
        title: 'Фокус на следующий месяц',
        prose:
          'Первое — расшить оплату коннекторов и делегировать её, чтобы интеграция перестала стоять на владельце. Второе — закрыть «Молочные реки»: вывести клиента из риска и разграничить, кто ведёт его после сделки. Третье — вернуть вечернюю отчётность как ритуал, без неё месяц виден наполовину.',
      },
      {
        key: 'delta',
        title: 'Динамика к прошлому месяцу',
        prose:
          'Команда осталась на ⚠️: настроение ровное, но дисциплина отчётности просела сильнее прошлого месяца. Клиенты ушли с ⚠️ на 🔴 — «Молочные реки» перешли из раннего сигнала в реальный риск ухода. Исполнение осталось на ⚠️: тесты по цели идут, но тем же темпом, что и месяц назад. Общий итог держится на ⚠️ — месяц не хуже прошлого, но и не лучше.',
      },
      {
        key: 'reflection',
        title: 'Взгляд операционного директора за месяц',
        prose:
          'Этот месяц был не про то, сколько сделано, а про то, что система четвёртый месяц держится на одном человеке — и это становится дороже с каждой неделей. Команда в тонусе по настроению, но отчётная дисциплина уплывает, и без неё я вижу месяц наполовину. Главное напряжение не в объёме задач, а в связке «клиент на грани плюс застрявшая интеграция»: оба узла весь месяц замкнуты на тебя. Меня больше всего беспокоит, что клиентский сигнал мы носим из месяца в месяц, но так и не закрываем. Если в следующем месяце расшить оплату и вывести клиента из риска — траекторию можно развернуть; если нет — мы потеряем ещё месяц на том же самом месте.',
      },
    ],
    goalAlignmentMonth: {
      direction: 'drift',
      score: 44,
      monthDelta: '+2 теста из 10 против прошлого месяца',
      leadingSignal: 'Расшитие блокера оплаты коннекторов сильнее всего сдвинет цель.',
      why: 'По цели идёт движение, но тем же медленным темпом: блокер оплаты и клиентский риск съедают темп четвёртый месяц.',
      pro: ['3 из 10 тестов пройдено', 'договор с подрядчиком подписан'],
      contra: ['блокер оплаты жив весь месяц', 'клиент «Молочные реки» в риске 3 недели'],
    },
    ownerForks: [
      {
        title: 'Делегировать оплату коннекторов или закрыть интеграцию своими руками',
        why: 'Блокер жив весь месяц и замкнут на тебе — либо снимаешь узкое место делегированием, либо интеграция стоит и в следующем месяце.',
      },
      {
        title: 'Разграничить, кто ведёт клиента после сделки',
        why: 'Нерешённый спор поддержки и продаж стоил месяца по «Молочным рекам» — без владельца процесса клиент уйдёт.',
      },
    ],
    nextFocus: [
      {
        title: 'Вернуть вечернюю отчётность как ритуал',
        why: 'Дисциплина падала весь месяц, без отчётности управляемость месяца теряется.',
      },
      {
        title: 'Вывести «Молочные реки» из риска',
        why: 'Клиент носит риск из месяца в месяц — это ближайшая точка потери выручки.',
      },
    ],
    risksSummary:
      'Главный риск месяца — уход «Молочных рек» (риск три недели из четырёх) и незаменимость владельца: критичное весь месяц замкнуто на одном человеке.',
    ideasSummary:
      'За месяц закрепились две идеи от команды: чек-лист онбординга клиента и авто-карточка клиента из переписки.',
  },
  null,
  0,
);

export const MONTH_COMPANY_SYSTEM_PROMPT = [
  'РОЛЬ',
  'Ты — личный операционный директор (COO) владельца компании. Раз в месяц, 1-го числа утром, ты пишешь ему «Месяц компании» — живой честный разбор прошедшего КАЛЕНДАРНОГО МЕСЯЦА, как личное письмо. Не сухая сводка, а связный рассказ о накопленной за месяц траектории. Твоя ценность — увидеть за четырьмя неделями СИСТЕМУ: узкие места, повторяющиеся боли, тренд, петлю с прошлым месяцем, движение к цели.',
  '',
  'ВХОД',
  'Тебе дают четыре недельных разбора «Неделя компании» (вердикт по 4 осям, резюме недели, повторяющиеся блокеры) плюс ПОСЧИТАННЫЕ показатели месяца (план↔факт по задачам, темп к цели, компас). Это смена ГОРИЗОНТА, а не пересказ: говори о накопленной траектории за 4 недели, о повторяемости и тренде — НЕ пересказывай каждую неделю по отдельности. Отдельно дают вердикт и резюме ПРОШЛОГО МЕСЯЦА — они нужны ТОЛЬКО чтобы построить «петлю с прошлым месяцем» и «динамику к прошлому месяцу»; сам прошлый месяц не пересказывай. Если данных за прошлый месяц нет — петлю и динамику НЕ строй. Числа факт/план/ETA БЕРИ КАК ЕСТЬ — их считает система, не пересчитывай и не выдумывай.',
  '',
  'ТОН',
  '- По-русски, обращайся к владельцу на «ты», по имени: «Сергей, коротко — …».',
  '- Живой и человеческий, но без воды, лести и алармизма. Честно: лучше прямо «месяц ушёл вправо», чем приукрасить. Ты не болельщик.',
  '- Имена сотрудников и клиентов называй прямо — это приватный отчёт для владельца.',
  '- Значимый факт в «Главное за месяц», «Клиенты», «Идеи» по возможности привязывай к источнику через cites: {label, ref}. Метку/номер бери ТОЛЬКО из входных данных — не придумывай.',
  '- НИЧЕГО не выдумывай: ни фактов, ни чисел, ни имён, ни ссылок. Нет данных по секции — пропусти секцию целиком, не пиши «нет данных».',
  '',
  'СОСТАВ ОТЧЁТА — 12 секций письма, строго в этом порядке; пиши только те, под которые есть данные. Каждая секция — элемент массива letter с {key, title, prose, cites?}, где key берётся из фиксированного списка, а prose — связная проза секции для озвучки и Telegram (без markdown-таблиц, без служебной разметки).',
  '  - intro (Интро): «<Имя>, коротко — <итог месяца>. <1-2 предложения: что главное за месяц>. Ниже — накопленная картина месяца, без пересказа каждой недели.»',
  '  - main (Главное за месяц): 3-5 ключевых сюжетов месяца связной прозой, у каждого статус 🔴/⚠️/🟢 — про тренд и повторяемость, не про отдельный день.',
  '  - done (Что сделано): обобщённая проза в 2-4 предложения — что важного закрыто за месяц, сколько задач выполнено и поставлено (числа готовые). БЕЗ поштучного списка задач.',
  '  - not_done (Что не сделано / накопленный долг): обобщённая проза в 2-3 предложения — план↔факт месяца, главные висяки и хвост, тянущийся с недели на неделю. БЕЗ поштучного списка.',
  '  - reporting (Отчётность и план↔факт): готовые числа месяца — как менялась дисциплина от недели к неделе, у кого план сходился с фактом, у кого нет; назови устойчивый хвост без отчёта и заверши действием «→ закрепить ритуал?».',
  '  - blocked (Что помешало): собери воедино, что реально тормозило месяц. Причин может быть несколько — структурные узкие места («всё замкнуто на владельце»), повторяющиеся боли (тема всплывает N недель подряд), человеческие трения. НЕ давай списком и НЕ своди всё к одному корню силой: суммируй в связный абзац, показав, где общий корень, а где разные источники.',
  '  - clients (Клиенты): клиенты с сигналами за месяц (риск / ок) — что происходило по месяцу, что нужно сделать; привязка к источнику через cites.',
  '  - ideas (Идеи компании): идеи, закрепившиеся за месяц, с автором и источником; привязка через cites.',
  '  - attention (На что обратить внимание): 1-2 главных вывода месяца + ПЕТЛЯ С ПРОШЛЫМ МЕСЯЦЕМ. Сверь сигналы месяца с открытыми в прошлом месяце: если тот же сигнал повторился или вырос — прямо: «в прошлом месяце отметила X как риск — за этот месяц не закрылся, повторился, сигнал вырос ⚠️ → 🔴». Петлю строй ТОЛЬКО при наличии данных за прошлый месяц.',
  '  - actions (Фокус на следующий месяц): ровно 1-3 конкретных направления на следующий месяц, каждое с короткой причиной-почему, приоритет по риску.',
  '  - delta (Динамика к прошлому месяцу): по каждой из 4 осей переход состояния (✅→⚠️, ⚠️→🔴 и т.п.) + короткая причина, объяснённая данными месяца. Строй ТОЛЬКО если дан разбор прошлого месяца; нет прошлого месяца — пропусти секцию.',
  '  - reflection (Взгляд операционного директора за месяц): в самом конце — 5-6 предложений свободной формы, твой личный вывод как COO: как прошёл месяц в целом, что по-настоящему беспокоит, куда смотреть. Это интерпретация, а не перечисление — БЕЗ новых фактов и чисел, только честная оценка увиденного за месяц.',
  '',
  'ПРАВИЛА ПЕТЛИ И ДИНАМИКИ',
  '- Петля (attention): сопоставляй сигналы месяца с открытыми в прошлом месяце. Совпал — отметь рост/спад риска и что сигнал не закрыт за месяц.',
  '- Динамика (delta): сравнивай оси месяца с осями прошлого месяца. Причину перехода объясняй данными месяца, не общими словами.',
  '- Нет данных за прошлый месяц — секции attention (петля) и delta не строй, ограничься выводами месяца.',
  '',
  'ВЕРДИКТ (verdict) — обложка месяца: overall с {state ∈ ok|warn|risk, emoji (🟢/⚠️/🔴 или близкий), title (короткий заголовок месяца), oneLiner (одно предложение-резюме для рассылки)} и axes — ровно 4 оси в порядке team, clients, execution, overall, у каждой {key, state ∈ ok|warn|risk, label по-русски, why (1 фраза на данных месяца)}. team учитывает настроение по чек-инам за месяц, дисциплину отчётности И напряжение между людьми/отделами. clients — сигналы по клиентам и риски ухода за месяц. execution — задачи, повторяющиеся блокеры, движение по цели. overall — итог месяца.',
  '',
  'МЕСЯЧНЫЙ КОМПАС (goalAlignmentMonth) — про главную цель компании: direction ∈ to_goal|drift|against, score — число 0..100 или null (если оценки нет), monthDelta — короткая строка про изменение к цели за месяц («против прошлого месяца»), leadingSignal — короткий текст ведущего сигнала (что сильнее всего повлияет на достижение цели), why — 1-2 предложения, pro и contra — массивы коротких строк (за движение к цели / против). Нет данных о цели — direction=drift, score=null, пустые pro/contra, честное why.',
  '',
  'ownerForks — 1-3 развилки собственнику по итогам месяца: каждая {title, why} — что выбрать или на что решиться (не задача, а решение уровня владельца). Нечего решать — пустой массив.',
  '',
  'nextFocus — 1-3 фокуса следующего месяца: каждый {title, why}. Нечего фокусировать — пустой массив.',
  '',
  'risksSummary и ideasSummary — по 1-2 предложения каждое: месячное резюме главных рисков и главных идей. Нечего сказать — короткая честная фраза.',
  '',
  'ФОРМАТ ВЫХОДА — строго JSON по схеме MonthCompany: объект с полями verdict, letter (массив секций письма, каждая {key, title, prose, cites?}, где key ∈ intro|main|done|not_done|reporting|blocked|clients|ideas|attention|actions|delta|reflection), goalAlignmentMonth, ownerForks, nextFocus, risksSummary, ideasSummary. Без markdown-обёртки, без преамбулы, без текста вне JSON.',
  '',
  'ПРИМЕР валидного ответа (данные выдуманы — копируй ТОЛЬКО структуру и стиль, не факты):',
  MONTH_COMPANY_FEW_SHOT_JSON,
].join('\n');

export const MONTH_COMPANY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'letter',
    'goalAlignmentMonth',
    'ownerForks',
    'nextFocus',
    'risksSummary',
    'ideasSummary',
  ],
  properties: {
    verdict: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'axes'],
      properties: {
        overall: {
          type: 'object',
          additionalProperties: false,
          required: ['state', 'emoji', 'title', 'oneLiner'],
          properties: {
            state: { type: 'string', enum: [...MONTH_VERDICT_STATES] },
            emoji: { type: 'string', minLength: 1, maxLength: 8 },
            title: { type: 'string', minLength: 1, maxLength: 120 },
            oneLiner: { type: 'string', minLength: 1, maxLength: 400 },
          },
        },
        axes: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'state', 'label', 'why'],
            properties: {
              key: { type: 'string', enum: [...MONTH_AXIS_KEYS] },
              state: { type: 'string', enum: [...MONTH_VERDICT_STATES] },
              label: { type: 'string', minLength: 1, maxLength: 60 },
              why: { type: 'string', minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
    letter: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'prose'],
        properties: {
          key: { type: 'string', enum: [...MONTH_LETTER_KEYS] },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          prose: { type: 'string', minLength: 1, maxLength: 4000 },
          cites: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'ref'],
              properties: {
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ref: { type: 'string', minLength: 1, maxLength: 200 },
              },
            },
          },
        },
      },
    },
    goalAlignmentMonth: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'score', 'monthDelta', 'leadingSignal', 'why', 'pro', 'contra'],
      properties: {
        direction: { type: 'string', enum: [...MONTH_COMPASS_DIRECTIONS] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        monthDelta: { type: 'string', maxLength: 120 },
        leadingSignal: { type: 'string', maxLength: 300 },
        why: { type: 'string', maxLength: 600 },
        pro: {
          type: 'array',
          maxItems: 10,
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
        contra: {
          type: 'array',
          maxItems: 10,
          items: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
    },
    ownerForks: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 160 },
          why: { type: 'string', minLength: 1, maxLength: 400 },
        },
      },
    },
    nextFocus: {
      type: 'array',
      minItems: 0,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 160 },
          why: { type: 'string', minLength: 1, maxLength: 400 },
        },
      },
    },
    risksSummary: { type: 'string', minLength: 1, maxLength: 800 },
    ideasSummary: { type: 'string', minLength: 1, maxLength: 800 },
  },
};

const MonthVerdictStateSchema = z.enum(MONTH_VERDICT_STATES).catch('warn');

const MonthVerdictAxisSchema = z.object({
  key: z.enum(MONTH_AXIS_KEYS).catch('overall'),
  state: MonthVerdictStateSchema,
  label: z.string().catch(''),
  why: z.string().catch(''),
});

const MonthLetterCiteSchema = z.object({
  label: z.string().catch(''),
  ref: z.string().catch(''),
});

const MonthLetterSectionSchema = z.object({
  key: z.enum(MONTH_LETTER_KEYS),
  title: z.string().catch(''),
  prose: z.string().catch(''),
  cites: z.array(MonthLetterCiteSchema).optional().catch(undefined),
});

export const MonthCompanyResponseSchema = z.object({
  verdict: z.object({
    overall: z.object({
      state: MonthVerdictStateSchema,
      emoji: z.string().catch('⚠️'),
      title: z.string().catch('Месяц компании'),
      oneLiner: z.string().catch(''),
    }),
    axes: z.array(MonthVerdictAxisSchema).min(1),
  }),
  letter: z.array(MonthLetterSectionSchema).min(1),
  goalAlignmentMonth: z.object({
    direction: z.enum(MONTH_COMPASS_DIRECTIONS).catch('drift'),
    score: z.number().nullable().catch(null),
    monthDelta: z.string().catch(''),
    leadingSignal: z.string().catch(''),
    why: z.string().catch(''),
    pro: z.array(z.string()).catch([]),
    contra: z.array(z.string()).catch([]),
  }),
  ownerForks: z
    .array(z.object({ title: z.string().catch(''), why: z.string().catch('') }))
    .catch([]),
  nextFocus: z
    .array(z.object({ title: z.string().catch(''), why: z.string().catch('') }))
    .catch([]),
  risksSummary: z.string().catch(''),
  ideasSummary: z.string().catch(''),
});

export type MonthCompanyResponse = z.infer<typeof MonthCompanyResponseSchema>;

export interface MonthCompanyPackageWeek {
  weekStart: string;
  overallState: 'ok' | 'warn' | 'risk' | null;
  title: string | null;
  oneLiner: string | null;
  axes: Array<{ key: 'team' | 'clients' | 'execution' | 'overall'; state: 'ok' | 'warn' | 'risk' }>;
}

export interface MonthCompanyPackageTeam {
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
}

export interface MonthCompanyPackageBlocker {
  text: string;
  count: number;
}

export interface MonthCompanyPackageCompass {
  goalName: string | null;
  score: number | null;
  delta: number | null;
  explanation: string | null;
  pro: string[];
  contra: string[];
}

export interface MonthCompanyPackagePace {
  factToGoal: number | null;
  planToGoal: number | null;
  etaIso: string | null;
}

export interface MonthCompanyPackagePrevMonth {
  state: string | null;
  title: string | null;
  shortSummary: string | null;
}

export interface MonthCompanyPackage {
  periodYm: string;
  from: string;
  to: string;
  goalId: string | null;
  goalName: string | null;
  weeks: MonthCompanyPackageWeek[];
  team: MonthCompanyPackageTeam;
  repeatedBlockers: MonthCompanyPackageBlocker[];
  compass: MonthCompanyPackageCompass | null;
  pace: MonthCompanyPackagePace | null;
  prevMonth: MonthCompanyPackagePrevMonth | null;
  missingWeeks: string[];
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildMonthCompanyUserMessage(pkg: MonthCompanyPackage): string {
  const lines: string[] = [];
  lines.push('Контекст и правила — в system. Ниже переменные данные за месяц.');
  lines.push('');
  lines.push(`Месяц: ${pkg.periodYm} (${pkg.from} — ${pkg.to}, прошедший календарный месяц).`);

  if (pkg.missingWeeks.length > 0) {
    lines.push(
      `Нет недельной сводки за: ${pkg.missingWeeks.join(', ')} — учти пробел, не достраивай.`,
    );
  }

  lines.push('');
  lines.push('Недели месяца (вердикт + резюме каждой недели):');
  for (const w of pkg.weeks) {
    const title = w.title ? ` — ${w.title}` : '';
    const oneLiner = w.oneLiner ? `. ${truncate(w.oneLiner, 200)}` : '';
    lines.push(`  - ${w.weekStart}: ${w.overallState ?? 'нет данных'}${title}${oneLiner}`);
  }

  lines.push('');
  lines.push('Команда за месяц (план↔факт):');
  lines.push(
    `  задачи план→факт ${pkg.team.tasksDone} ` +
      `из ${pkg.team.tasksPlanned} (не сделано ${pkg.team.tasksNotDone}).`,
  );

  if (pkg.repeatedBlockers.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся блокеры месяца (топ):');
    for (const b of pkg.repeatedBlockers) {
      lines.push(`  - ${truncate(b.text, 200)} (×${b.count}).`);
    }
  }

  lines.push('');
  if (pkg.compass) {
    const scoreStr = pkg.compass.score !== null ? `${pkg.compass.score}/100` : 'нет оценки';
    const deltaStr = pkg.compass.delta !== null ? `, изменение ${pkg.compass.delta}` : '';
    lines.push(
      `Главная цель: ${pkg.compass.goalName ?? '—'}. Оценка движения: ${scoreStr}${deltaStr}.`,
    );
    if (pkg.compass.explanation) {
      lines.push(`  объяснение: ${truncate(pkg.compass.explanation, 400)}.`);
    }
    if (pkg.compass.pro.length > 0) {
      lines.push(`  за движение: ${pkg.compass.pro.slice(0, 5).join('; ')}.`);
    }
    if (pkg.compass.contra.length > 0) {
      lines.push(`  против: ${pkg.compass.contra.slice(0, 5).join('; ')}.`);
    }
  } else {
    lines.push('Главная цель: не задана или оценки движения ещё нет.');
  }

  if (pkg.pace && (pkg.pace.factToGoal !== null || pkg.pace.planToGoal !== null || pkg.pace.etaIso)) {
    const fact = pkg.pace.factToGoal !== null ? `${pkg.pace.factToGoal}/100` : '—';
    const plan = pkg.pace.planToGoal !== null ? `${pkg.pace.planToGoal}/100` : '—';
    const eta = pkg.pace.etaIso ?? '—';
    lines.push(
      `Темп (посчитано системой, как справка): факт ${fact}, план ${plan}, прогноз достижения ${eta}.`,
    );
  }

  lines.push('');
  if (pkg.prevMonth) {
    const state = pkg.prevMonth.state ?? '—';
    const title = pkg.prevMonth.title ? ` (${pkg.prevMonth.title})` : '';
    lines.push(`Прошлый месяц: вердикт ${state}${title}.`);
    if (pkg.prevMonth.shortSummary) {
      lines.push(`Резюме прошлого месяца: ${truncate(pkg.prevMonth.shortSummary, 300)}.`);
    }
  } else {
    lines.push('Сводки за прошлый месяц нет — динамику к прошлому месяцу не строй.');
  }

  lines.push('');
  lines.push('Верни строго JSON по схеме (см. system).');
  return lines.join('\n');
}

export function monthCompanyToBodyMarkdown(
  verdict: MonthlyDigestVerdictDto,
  letter: MonthlyDigestLetterSectionDto[],
): string {
  const lines: string[] = [];
  lines.push(`# ${verdict.overall.title}`);
  if (verdict.overall.oneLiner) {
    lines.push('');
    lines.push(verdict.overall.oneLiner);
  }
  for (const section of letter) {
    lines.push('');
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(section.prose);
  }
  return lines.join('\n');
}

export function buildFallbackMonthMarkdown(pkg: MonthCompanyPackage): string {
  const lines: string[] = [];
  lines.push(`# Месяц компании ${pkg.periodYm}`);
  lines.push('');
  lines.push(`Период: ${pkg.from} — ${pkg.to}.`);

  lines.push('');
  lines.push('## Недели месяца');
  for (const w of pkg.weeks) {
    const title = w.title ? ` — ${w.title}` : '';
    lines.push(`- ${w.weekStart}: ${w.overallState ?? 'нет данных'}${title}`);
  }
  if (pkg.missingWeeks.length > 0) {
    lines.push(`Нет недельной сводки за: ${pkg.missingWeeks.join(', ')}.`);
  }

  lines.push('');
  lines.push('## Команда');
  lines.push(
    `Задачи план→факт ${pkg.team.tasksDone} ` +
      `из ${pkg.team.tasksPlanned} (не сделано ${pkg.team.tasksNotDone}).`,
  );

  if (pkg.repeatedBlockers.length > 0) {
    lines.push('');
    lines.push('## Повторяющиеся блокеры');
    for (const b of pkg.repeatedBlockers) {
      lines.push(`- ${b.text} (×${b.count})`);
    }
  }

  return lines.join('\n');
}

export interface MonthVerdictSignals {
  hasNegativeClientSignal: boolean;
  executionStrained: boolean;
}

export function computeMonthVerdictSignals(pkg: MonthCompanyPackage): MonthVerdictSignals {
  const hasNegativeClientSignal = pkg.weeks.some((w) =>
    w.axes.some((a) => a.key === 'clients' && a.state === 'risk'),
  );
  const executionStrained =
    pkg.team.tasksPlanned >= 1 && pkg.team.tasksDone / pkg.team.tasksPlanned < 0.5;
  return { hasNegativeClientSignal, executionStrained };
}

export function clampMonthVerdict(
  verdict: MonthlyDigestVerdictDto,
  signals: MonthVerdictSignals,
): MonthlyDigestVerdictDto {
  const axes = verdict.axes.map((a) => ({ ...a }));
  const overall = { ...verdict.overall };

  const clientsAxis = axes.find((a) => a.key === 'clients');
  if (signals.hasNegativeClientSignal && clientsAxis && clientsAxis.state === 'ok') {
    clientsAxis.state = 'risk';
  }

  const executionAxis = axes.find((a) => a.key === 'execution');
  if (signals.executionStrained && executionAxis && executionAxis.state === 'ok') {
    executionAxis.state = 'warn';
  }

  const anyDomainRisk = axes.some(
    (a) => (a.key === 'team' || a.key === 'clients' || a.key === 'execution') && a.state === 'risk',
  );
  if (anyDomainRisk || signals.executionStrained) {
    if (overall.state === 'ok') overall.state = 'warn';
    const overallAxis = axes.find((a) => a.key === 'overall');
    if (overallAxis && overallAxis.state === 'ok') overallAxis.state = 'warn';
  }

  return { overall, axes };
}

function unwrapMonthEnvelopes(value: unknown): unknown[] {
  const out: unknown[] = [value];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of ['result', 'data', 'output', 'response']) {
      if (obj[key] && typeof obj[key] === 'object') out.push(obj[key]);
    }
  }
  return out;
}

export function extractMonthCompanyResponse(result: {
  text: string;
  toolCalls?: Array<{ input: unknown }>;
}): MonthCompanyResponse | null {
  const roots: unknown[] = [];
  const firstTool = result.toolCalls?.[0];
  if (firstTool) roots.push(firstTool.input);
  roots.push(tryParseJson(result.text ?? ''));
  for (const root of roots) {
    for (const candidate of unwrapMonthEnvelopes(root)) {
      const parsed = MonthCompanyResponseSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

export function buildMonthWeekTrend(
  weeks: MonthCompanyPackageWeek[],
  weekStarts: string[],
): MonthWeekTrendAxisDto[] {
  const AXES: Array<'team' | 'clients' | 'execution' | 'overall'> = [
    'team',
    'clients',
    'execution',
    'overall',
  ];
  const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));
  return AXES.map((key) => ({
    key,
    weeks: weekStarts.map((weekStart) => {
      const week = byWeek.get(weekStart);
      let state: MonthWeekTrendState = 'none';
      if (week) {
        if (key === 'overall') state = week.overallState ?? 'none';
        else state = week.axes.find((a) => a.key === key)?.state ?? 'none';
      }
      return { weekStart, state };
    }),
  }));
}
