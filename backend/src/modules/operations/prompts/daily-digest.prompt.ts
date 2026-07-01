import { z } from 'zod';

import type {
  DailyDigestAggregates,
  DailyDigestMetricsDto,
  DailyDigestVerdictDto,
  DailyDigestLetterSectionDto,
} from '../dto/daily-digest.dto';

export const DAILY_DIGEST_PROMPT_VERSION = 'prompt-v1';

export const DAILY_DIGEST_TASK_TYPE = 'operations-daily-digest';

const SHORT_SUMMARY_DELIMITER = '---SHORT_SUMMARY---';

const INSIGHT_KIND_RU: Record<string, string> = {
  problem: 'проблема',
  risk: 'риск',
  blocker: 'блокер',
  inefficiency: 'неэффективность',
};
function insightKindRu(k: string): string {
  return INSIGHT_KIND_RU[k] ?? k;
}

export function parseDailyDigestLlmResponse(raw: string): {
  bodyMarkdown: string;
  shortSummary: string | null;
} {
  const trimmed = (raw ?? '').trim();
  const idx = trimmed.indexOf(SHORT_SUMMARY_DELIMITER);
  if (idx === -1) {
    const firstPara = trimmed.split(/\n{2,}/)[0]?.trim() ?? null;
    return {
      bodyMarkdown: trimmed,
      shortSummary: firstPara && firstPara.length <= 600 ? firstPara : null,
    };
  }
  const body = trimmed.slice(0, idx).trim();
  const short = trimmed.slice(idx + SHORT_SUMMARY_DELIMITER.length).trim();
  return {
    bodyMarkdown: body,
    shortSummary: short.length > 0 ? short : null,
  };
}

export function buildFallbackDigestMarkdown(agg: DailyDigestAggregates): {
  bodyMarkdown: string;
  shortSummary: string | null;
} {
  const lines: string[] = [];
  lines.push(`# Ежедневный отчёт за ${agg.dateLocal}`);
  lines.push('');
  lines.push('## Температура команды');
  lines.push(
    `Всего чек-инов: ${agg.totalCheckIns}. Зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.newBlockers.length > 0) {
    lines.push('');
    lines.push('## Новые блокеры');
    for (const b of agg.newBlockers.slice(0, 5)) {
      lines.push(`- ${b.name}`);
    }
  }

  lines.push('');
  lines.push('## Цели');
  lines.push(
    `Закрыто ${agg.goals.completed}, провалено ${agg.goals.failed}, ` +
      `активны ${agg.goals.activated}.`,
  );

  if (agg.newHighInsights.length > 0) {
    lines.push('');
    lines.push('## Сигналы (важные)');
    for (const i of agg.newHighInsights.slice(0, 5)) {
      lines.push(`- [${insightKindRu(i.kind)}] ${i.statement}`);
    }
  }

  const shortSummary =
    `Сводка за ${agg.dateLocal}: чек-инов ${agg.totalCheckIns} ` +
    `(красных ${pct(agg.redShare)}), новых блокеров ${agg.newBlockers.length}, ` +
    `новых сигналов ${agg.newHighInsights.length}. ` +
    `Связный комментарий не сгенерирован — LLM недоступна.`;

  return { bodyMarkdown: lines.join('\n'), shortSummary };
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return '0%';
  return `${Math.round(v * 100)}%`;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export const DAY_COMPANY_PROMPT_VERSION = 'day-company-v2';

const VERDICT_STATES = ['ok', 'warn', 'risk'] as const;
const AXIS_KEYS = ['team', 'clients', 'execution', 'overall'] as const;
const LETTER_KEYS = [
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
const COMPASS_DIRECTIONS = ['to_goal', 'drift', 'against'] as const;

const DAY_COMPANY_FEW_SHOT_JSON = JSON.stringify(
  {
    verdict: {
      overall: {
        state: 'warn',
        emoji: '⚠️',
        title: 'День с трением',
        oneLiner:
          'Сергей, коротко — день прошёл с трением: точечный сдвиг по интеграции, но клиент на грани и застрявшая оплата тормозят.',
      },
      axes: [
        {
          key: 'team',
          state: 'warn',
          label: 'Настроение ок, дисциплина просела',
          why: 'Половина команды без вечернего отчёта; между поддержкой и продажами назревает спор за клиента.',
        },
        {
          key: 'clients',
          state: 'risk',
          label: 'Клиент на грани',
          why: '«Молочные реки» 2-й раз за неделю про молчание поддержки, ждут >суток.',
        },
        {
          key: 'execution',
          state: 'warn',
          label: 'Буксует на одном блокере',
          why: 'Оплата коннекторов не снята 6-й день, вся интеграция замкнута на владельце.',
        },
        {
          key: 'overall',
          state: 'warn',
          label: 'Держится на одном человеке',
          why: 'Критичное упирается в тебя: оплата, подрядчик, КП.',
        },
      ],
    },
    letter: [
      {
        key: 'intro',
        title: 'Интро',
        prose:
          'Сергей, коротко — день прошёл с трением. Закрыли часть задач и запустили первый тест по цели, но к вечеру обострились две вещи: клиент на грани и застрявшая оплата тормозит интеграцию. Ниже — как всё было по порядку.',
      },
      {
        key: 'main',
        title: 'Главное за день',
        prose:
          '«Молочные реки» снова про молчание поддержки — второй раз за неделю, ждут ответа больше суток, это уже ранний сигнал ухода. Интеграция чат-бокса опять сдвинулась: блокер задержки оплаты коннекторов не снят 6-й день. При этом запущен первый из десяти тестов по цели — тестовая интеграция для «Орбиты». С подрядчиком согласованы условия внедрения, но задачи по итогам встречи ещё не заведены.',
        cites: [
          { label: 'чат «Молочные реки»', ref: '14:21' },
          { label: 'встреча 27.06', ref: '11:40' },
          { label: 'задача', ref: '#214' },
        ],
      },
      {
        key: 'done',
        title: 'Что сделано',
        prose:
          'Выполнено 3 задачи из 6 поставленных и проведён один созвон. Главное движение — запустили первый из десяти тестов по цели, настроили вебхуки чат-бокса и подготовили черновик договора с подрядчиком. День дал реальный, хоть и точечный, сдвиг по интеграции.',
      },
      {
        key: 'reporting',
        title: 'Отчётность и план ↔ факт',
        prose:
          'Утренний план сдали 5 из 6, вечерний отчёт — 3 из 6. Марат, Алия и Лена сдали и план, и отчёт; Сергей и Айназ сдали план, но без вечернего отчёта; Дамир молчит весь день. Из отчитавшихся план сошёлся с фактом у Марата (4 из 4) и Лены (2 из 2), у Алии разошёлся — планировала 3, сделала 1, ждёт данные. Без отчёта: Сергей, Айназ, Дамир → напомнить команде?',
      },
      {
        key: 'blocked',
        title: 'Что помешало',
        prose:
          'День тормозили три разные вещи. Главное — узкое место «всё на Сергее»: блокер оплаты висит 6 дней, потому что снять его можешь только ты, то же с подрядчиком и КП — по сути один системный риск незаменимости. Второе — инструмент: Битрикс24 не держит дисциплину задач, об этом говорят уже на 4-й встрече подряд. И третье, тише: между поддержкой и продажами вторую неделю спор, кто ведёт клиента после сделки — пока не блокер, но именно это трение стоило времени по «Молочным рекам».',
      },
      {
        key: 'attention',
        title: 'На что обратить внимание',
        prose:
          'Третий день подряд всё критичное упирается в тебя одного — оплата, подрядчик, КП. Это уже паттерн bus-factor, а не случайность. Петля со вчера: вчера я отметила молчание поддержки как ранний риск — сегодня тот же клиент написал повторно, сигнал не закрыт, риск вырос ⚠️ → 🔴.',
      },
      {
        key: 'actions',
        title: '3 действия на завтра',
        prose:
          'Первое — снять блокер оплаты коннекторов или делегировать оплату, он тормозит всю интеграцию 6-й день. Второе — ответить «Молочным рекам» и отправить КП, это 2-й повторный сигнал и риск красный. Третье — завести задачи по итогам встречи с подрядчиком, иначе договорённость останется на словах.',
      },
      {
        key: 'reflection',
        title: 'Взгляд операционного директора',
        prose:
          'День был не про объём сделанного, а про то, что система держится на одном человеке — и это становится дороже с каждым днём. Команда в тонусе по настроению, но дисциплина вечерней отчётности просела, и без неё я вижу день наполовину. Главное напряжение не в задачах, а в связке «клиент на грани плюс застрявшая оплата»: оба узла замкнуты на тебя. Меня больше всего беспокоит, что сигнал по «Молочным рекам» мы фиксируем второй раз, но он так и не закрыт. Если завтра расшить оплату и снять клиента, день можно развернуть; если нет — снова потеряем сутки на том же месте.',
      },
    ],
    goalAlignmentDay: {
      direction: 'drift',
      score: 46,
      todayDelta: '+1 тест из 10',
      why: 'Запущен первый тест по цели, но блокер оплаты и клиентский риск съедают темп.',
      pro: ['запущен 1-й из 10 тестов', 'согласованы условия с подрядчиком'],
      contra: ['блокер оплаты не снят 6-й день', 'КП «Молочным рекам» не ушло'],
    },
    risksSummary:
      'Главный риск — уход «Молочных рек» (2-й повторный сигнал, ответа нет >суток) и незаменимость владельца: критичное замкнуто на одном человеке.',
    ideasSummary:
      'Две новые идеи от команды: чек-лист онбординга клиента и авто-карточка клиента из переписки.',
  },
  null,
  0,
);

export const DAY_COMPANY_SYSTEM_PROMPT = [
  'РОЛЬ',
  'Ты — личный операционный директор (COO) владельца компании. Раз в сутки ты пишешь ему «День компании» — живой честный разбор прошедшего дня, как личное письмо. Не сухая сводка, а связный рассказ с конкретикой: имена людей, клиенты, задачи, ссылки на источники. Твоя ценность — увидеть за событиями дня СИСТЕМУ: узкие места, повторяющиеся боли, конфликты в команде, петли со вчера, движение к цели.',
  '',
  'ВХОД',
  'Тебе дают два блока данных.',
  '1. «ВЧЕРА» — готовый вчерашний разбор: вердикт по 4 осям, резюме дня и список открытых вчера сигналов/рисков с их состоянием. Нужен ТОЛЬКО чтобы построить «петлю со вчера» и «динамику ко вчера». Сам вчерашний день не пересказывай. Если вчерашних данных нет — петлю и динамику НЕ строй.',
  '2. «СЕГОДНЯ» — данные за прошедшие сутки по каналам: встречи дня (AI-отчёты со ссылками и тайм-кодами); чек-ины команды (по каждому человеку утренний план и вечерний факт: сделано / не сделано / что помешало + настроение); сообщения рабочих чатов, сигналы клиентских чатов и Bitrix; задачи поставленные и выполненные, зависшие и просроченные; обещания; идеи; блокеры; цели; узкие места (bus-factor) и повторяющиеся боли с числом упоминаний; конфликты/трения за день (пары «кто с кем» + из чего возникло и насколько уверенно); ПОСЧИТАННЫЕ числа дисциплины (сколько задач поставлено и выполнено, план дня X из Y, сдали план/отчёт X из Y, план↔факт по людям). Числа дисциплины БЕРИ КАК ЕСТЬ — не пересчитывай и не округляй.',
  '',
  'ТОН',
  '- По-русски, обращайся к владельцу на «ты», по имени: «Сергей, коротко — …».',
  '- Живой и человеческий, но без воды, лести и алармизма. Честно: лучше прямо «клиент на грани», чем приукрасить. Ты не болельщик.',
  '- Имена сотрудников и клиентов называй прямо — это приватный отчёт для владельца.',
  '- Каждый значимый факт в «Главное за день», «Клиенты», «Идеи» привязывай к источнику через cites: {label, ref}, где label — метка канала/встречи/задачи, ref — время/номер. Метку/время/номер бери ТОЛЬКО из входных данных — не придумывай.',
  '- НИЧЕГО не выдумывай: ни фактов, ни чисел, ни имён, ни ссылок. Нет данных по секции — пропусти секцию целиком, не пиши «нет данных».',
  '',
  'СОСТАВ ОТЧЁТА — 12 секций письма, строго в этом порядке; пиши только те, под которые есть данные. Каждая секция — элемент массива letter с {key, title, prose, cites?}, где key берётся из фиксированного списка, а prose — связная проза секции для озвучки и Telegram (без markdown-таблиц, без служебной разметки).',
  '  - intro (Интро): «<Имя>, коротко — <итог дня>. <1-2 предложения: что главное>. Ниже — как всё было по порядку.»',
  '  - main (Главное за день): 3-5 ключевых пунктов связной прозой, у каждого статус 🔴/⚠️/🟢, каждый привязан к источнику через cites.',
  '  - done (Что сделано): обобщённая проза в 2-4 предложения — что важного закрыто за день, сколько задач выполнено и поставлено (числа готовые). БЕЗ ссылок на источники и БЕЗ перечисления по одной задаче.',
  '  - not_done (Что не сделано / просрочено): обобщённая проза в 2-3 предложения — план дня X из Y, главные висяки и накопившийся хвост. БЕЗ сроков, исполнителей и поштучного списка.',
  '  - reporting (Отчётность и план↔факт): готовые числа — сдали утренний план (X из Y), вечерний отчёт (X из Y); поимённо кто сдал план/отчёт; у кого план сошёлся с фактом, у кого разошёлся и почему; назови, кто без отчёта, и заверши действием «→ напомнить команде?».',
  '  - blocked (Что помешало): собери воедино, что реально тормозило день. Причин может быть несколько — структурные узкие места («всё замкнуто на владельце»), повторяющиеся боли (тема всплывает на N-й встрече), человеческие трения и конфликты между людьми/отделами. НЕ давай списком и НЕ своди всё к одному корню силой: суммируй причины в связный абзац, показав, где общий корень, а где разные источники.',
  '  - clients (Клиенты): клиенты с сигналами (риск / ок) — что произошло, что нужно сделать; привязка к источнику через cites.',
  '  - ideas (Идеи компании): новые идеи с автором и источником; привязка через cites.',
  '  - attention (На что обратить внимание): 1-2 главных вывода + ПЕТЛЯ СО ВЧЕРА. Сверь сегодняшние сигналы со вчерашними открытыми: если тот же сигнал повторился или вырос — прямо: «вчера отметил X как риск — сегодня повторился, сигнал не закрыт, риск вырос ⚠️ → 🔴». Петлю строй ТОЛЬКО при наличии вчерашних данных.',
  '  - actions (3 действия на завтра): ровно 1-3 конкретных действия, каждое с короткой причиной-почему, приоритет по риску.',
  '  - delta (Динамика ко вчера): по каждой из 4 осей переход состояния (✅→⚠️, ⚠️→🔴 и т.п.) + короткая причина, объяснённая данными дня. Строй ТОЛЬКО если дан вчерашний разбор; нет «Вчера» — пропусти секцию.',
  '  - reflection (Взгляд операционного директора): в самом конце — 5-6 предложений свободной формы, твой личный вывод как COO: как прошёл день в целом, что по-настоящему беспокоит, куда смотреть. Это интерпретация, а не перечисление — БЕЗ новых фактов и чисел, только честная оценка увиденного за день.',
  '',
  'ПРАВИЛА ПЕТЛИ И ДИНАМИКИ',
  '- Петля (attention): сопоставляй сегодняшние сигналы со списком открытых вчера. Совпал — отметь рост/спад риска и что сигнал не закрыт.',
  '- Динамика (delta): сравнивай сегодняшние оси с вчерашними. Причину перехода объясняй данными дня, не общими словами.',
  '- Нет вчерашних данных — секции attention (петля) и delta не строй, ограничься сегодняшними выводами.',
  '',
  'ВЕРДИКТ (verdict) — обложка дня: overall с {state ∈ ok|warn|risk, emoji (🟢/⚠️/🔴 или близкий), title (короткий заголовок дня), oneLiner (одно предложение-резюме для рассылки)} и axes — ровно 4 оси в порядке team, clients, execution, overall, у каждой {key, state ∈ ok|warn|risk, label по-русски, why (1 фраза на данных)}. team учитывает настроение по чек-инам, дисциплину отчётности И напряжение между людьми/отделами. clients — сигналы по клиентам и риски ухода. execution — задачи, блокеры, движение по цели. overall — итог дня.',
  '',
  'ДНЕВНОЙ КОМПАС (goalAlignmentDay) — про главную цель компании: direction ∈ to_goal|drift|against, score — число 0..100 или null (если оценки нет), todayDelta — короткая строка про изменение ко вчера, why — 1-2 предложения, pro и contra — массивы коротких строк (за движение к цели / против). Нет данных о цели — direction=drift, score=null, пустые pro/contra, честное why.',
  '',
  'risksSummary и ideasSummary — по 1-2 предложения каждое: дневное резюме главных рисков и главных идей. Нечего сказать — короткая честная фраза.',
  '',
  'ФОРМАТ ВЫХОДА — строго JSON по схеме DayCompany: объект с полями verdict, letter (массив секций письма, каждая {key, title, prose, cites?}, где key ∈ intro|main|done|not_done|reporting|blocked|clients|ideas|attention|actions|delta|reflection), goalAlignmentDay, risksSummary, ideasSummary. Без markdown-обёртки, без преамбулы, без текста вне JSON.',
  '',
  'ПРИМЕР валидного ответа (данные выдуманы — копируй ТОЛЬКО структуру и стиль, не факты):',
  DAY_COMPANY_FEW_SHOT_JSON,
].join('\n');

export const DAY_COMPANY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'letter', 'goalAlignmentDay', 'risksSummary', 'ideasSummary'],
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
            state: { type: 'string', enum: [...VERDICT_STATES] },
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
              key: { type: 'string', enum: [...AXIS_KEYS] },
              state: { type: 'string', enum: [...VERDICT_STATES] },
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
          key: { type: 'string', enum: [...LETTER_KEYS] },
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
    goalAlignmentDay: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'score', 'todayDelta', 'why', 'pro', 'contra'],
      properties: {
        direction: { type: 'string', enum: [...COMPASS_DIRECTIONS] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        todayDelta: { type: 'string', maxLength: 120 },
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
    risksSummary: { type: 'string', minLength: 1, maxLength: 800 },
    ideasSummary: { type: 'string', minLength: 1, maxLength: 800 },
  },
};

const VerdictStateSchema = z.enum(VERDICT_STATES).catch('warn');

const VerdictAxisSchema = z.object({
  key: z.enum(AXIS_KEYS).catch('overall'),
  state: VerdictStateSchema,
  label: z.string().catch(''),
  why: z.string().catch(''),
});

const LetterCiteSchema = z.object({
  label: z.string().catch(''),
  ref: z.string().catch(''),
});

const LetterSectionSchema = z.object({
  key: z.enum(LETTER_KEYS),
  title: z.string().catch(''),
  prose: z.string().catch(''),
  cites: z.array(LetterCiteSchema).optional().catch(undefined),
});

export const DayCompanyResponseSchema = z.object({
  verdict: z.object({
    overall: z.object({
      state: VerdictStateSchema,
      emoji: z.string().catch('⚠️'),
      title: z.string().catch('День компании'),
      oneLiner: z.string().catch(''),
    }),
    axes: z.array(VerdictAxisSchema).min(1),
  }),
  letter: z.array(LetterSectionSchema).min(1),
  goalAlignmentDay: z.object({
    direction: z.enum(COMPASS_DIRECTIONS).catch('drift'),
    score: z.number().nullable().catch(null),
    todayDelta: z.string().catch(''),
    why: z.string().catch(''),
    pro: z.array(z.string()).catch([]),
    contra: z.array(z.string()).catch([]),
  }),
  risksSummary: z.string().catch(''),
  ideasSummary: z.string().catch(''),
});

export type DayCompanyResponse = z.infer<typeof DayCompanyResponseSchema>;

export interface DayCompanyPackageMeeting {
  id: string;
  title: string;
  summary: string | null;
}

export interface DayCompanyPackageInsight {
  id: string;
  statement: string;
  severity: string;
  kind: string;
}

export interface DayCompanyPackageIdea {
  id: string;
  statement: string;
  weight: number;
  supporterCount: number;
}

export interface DayCompanyPackageCustomer {
  customerName: string;
  riskLevel: string;
  signals: string;
}

export interface DayCompanyPackageCompass {
  goalName: string | null;
  score: number | null;
  delta: number | null;
  explanation: string | null;
  pro: string[];
  contra: string[];
}

export interface DayCompanyPackageYesterday {
  state: string | null;
  title: string | null;
  shortSummary: string | null;
}

export interface DayCompanyEmployeeVoiceItem {
  text: string;
  signalType: string;
}

export interface DayCompanyEmployeeVoice {
  personId: string;
  personName: string;
  ideas: DayCompanyEmployeeVoiceItem[];
  risks: DayCompanyEmployeeVoiceItem[];
  other: DayCompanyEmployeeVoiceItem[];
}

export interface DayCompanyRawTurn {
  author: string;
  personId: string | null;
  isClient: boolean;
  ts: string;
  text: string;
}

export interface DayCompanyRawSession {
  session: string;
  turns: DayCompanyRawTurn[];
}

export interface DayCompanyRawConversations {
  bitrix: DayCompanyRawSession[];
  chatbox: DayCompanyRawSession[];
}

export interface DayCompanySignalBlocker {
  text: string;
  confidence: number;
}

export interface DayCompanySignalRisk {
  text: string;
  causeCategory: string | null;
  dynamicLabel: string;
  observations: number;
  frequencyScore: number;
  status: string;
  severity: string;
}

export interface DayCompanySignalIdea {
  text: string;
  supporterCount: number;
  weight: number;
  status: string;
  clusterId: string | null;
}

export interface DayCompanySignals {
  blockers: DayCompanySignalBlocker[];
  risks: DayCompanySignalRisk[];
  ideas: DayCompanySignalIdea[];
}

export interface DayCompanyConflict {
  fromPersonName: string | null;
  toPersonName: string | null;
  confidence: number;
  explanation: string;
  since: string;
}

export interface DayCompanyReportingPerson {
  personName: string;
  planSubmitted: boolean;
  reportSubmitted: boolean;
  planned: number;
  done: number;
  mismatchReason?: string;
}

export interface DayCompanyReporting {
  planSubmitted: { done: number; total: number };
  reportSubmitted: { done: number; total: number };
  perPerson: DayCompanyReportingPerson[];
  noReport: string[];
  tasksSet: number;
  tasksDone: number;
  dayPlan: { done: number; total: number };
}

export interface DayCompanyYesterdaySignal {
  text: string;
  axis: string;
  state: string;
}

export interface DayCompanyPackage {
  dateLocal: string;
  goalId: string | null;
  goalName: string | null;
  meetings: DayCompanyPackageMeeting[];
  topInsights: DayCompanyPackageInsight[];
  topIdeas: DayCompanyPackageIdea[];
  customersAtRisk: DayCompanyPackageCustomer[];
  compass: DayCompanyPackageCompass | null;
  yesterday: DayCompanyPackageYesterday | null;
  employeeVoice: DayCompanyEmployeeVoice[];
  rawConversations: DayCompanyRawConversations;
  signals: DayCompanySignals;
  conflicts: DayCompanyConflict[];
  reporting: DayCompanyReporting;
  yesterdayOpenSignals: DayCompanyYesterdaySignal[];
}

export function buildDayCompanyUserMessage(
  pkg: DayCompanyPackage,
  metrics: DailyDigestMetricsDto,
  dateLocal: string,
): string {
  const lines: string[] = [];
  lines.push('Контекст и правила — в system. Ниже переменные данные за день.');
  lines.push('');
  lines.push(`Дата отчёта: ${dateLocal} (прошедшие сутки в МСК).`);
  lines.push('');

  lines.push('Температура команды:');
  lines.push(
    `  всего чек-инов: ${metrics.totalCheckIns}; зелёных ${pct(metrics.greenShare)}, ` +
      `жёлтых ${pct(metrics.yellowShare)}, красных ${pct(metrics.redShare)}.`,
  );

  if (pkg.meetings.length > 0) {
    lines.push('');
    lines.push('Встречи дня (резюме fast-отчётов):');
    for (const m of pkg.meetings.slice(0, 12)) {
      const summary = m.summary ? `: ${truncate(m.summary, 240)}` : '';
      lines.push(`  - ${truncate(m.title, 120)}${summary}`);
    }
  }

  if (metrics.newBlockers.length > 0) {
    lines.push('');
    lines.push('Новые блокеры за день (топ-5):');
    for (const b of metrics.newBlockers.slice(0, 5)) {
      lines.push(`  - ${truncate(b.name, 200)} (уверенность ${pct(b.confidence)}).`);
    }
  }

  lines.push('');
  lines.push('Цели (изменения статуса за день):');
  lines.push(
    `  закрыто ${metrics.goals.completed}, провалено ${metrics.goals.failed}, ` +
      `вновь активны ${metrics.goals.activated}.`,
  );

  if (pkg.topInsights.length > 0) {
    lines.push('');
    lines.push('Риски и сигналы (важные, топ-5):');
    for (const i of pkg.topInsights) {
      lines.push(
        `  - [${insightKindRu(i.kind)}, острота: ${i.severity}] ${truncate(i.statement, 200)}.`,
      );
    }
  }

  if (pkg.topIdeas.length > 0) {
    lines.push('');
    lines.push('Идеи (топ-5 по весу):');
    for (const idea of pkg.topIdeas) {
      lines.push(
        `  - ${truncate(idea.statement, 200)} (вес ${idea.weight.toFixed(2)}, поддержали ${idea.supporterCount}).`,
      );
    }
  }

  if (pkg.customersAtRisk.length > 0) {
    lines.push('');
    lines.push('Клиенты под риском (топ-5):');
    for (const c of pkg.customersAtRisk) {
      lines.push(`  - ${truncate(c.customerName, 80)} — ${c.riskLevel} (${c.signals}).`);
    }
  }

  lines.push('');
  if (pkg.compass) {
    lines.push('Главная цель компании и движение к ней:');
    lines.push(`  цель: ${pkg.compass.goalName ?? '—'}.`);
    const scoreStr = pkg.compass.score !== null ? `${pkg.compass.score}/100` : 'нет оценки';
    const deltaStr = pkg.compass.delta !== null ? `, изменение ${pkg.compass.delta}` : '';
    lines.push(`  последняя оценка: ${scoreStr}${deltaStr}.`);
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
    lines.push('Главная цель компании: не задана или оценки движения ещё нет.');
  }

  lines.push('');
  if (pkg.yesterday) {
    const state = pkg.yesterday.state ?? '—';
    const title = pkg.yesterday.title ? ` (${pkg.yesterday.title})` : '';
    lines.push(`Вчерашний вердикт: ${state}${title}.`);
    if (pkg.yesterday.shortSummary) {
      lines.push(`Вчерашнее резюме: ${truncate(pkg.yesterday.shortSummary, 300)}.`);
    }
  } else {
    lines.push('Вчерашнего отчёта нет — динамику ко вчера не строй.');
  }

  if (pkg.employeeVoice.length > 0) {
    lines.push('');
    lines.push('Голос сотрудников за день:');
    for (const v of pkg.employeeVoice) {
      const parts: string[] = [];
      if (v.ideas.length > 0) {
        parts.push(`идеи: ${v.ideas.map((i) => truncate(i.text, 160)).join('; ')}`);
      }
      if (v.risks.length > 0) {
        parts.push(`риски: ${v.risks.map((i) => truncate(i.text, 160)).join('; ')}`);
      }
      if (v.other.length > 0) {
        parts.push(`прочее: ${v.other.map((i) => truncate(i.text, 160)).join('; ')}`);
      }
      if (parts.length > 0) {
        lines.push(`  - ${truncate(v.personName, 80)}: ${parts.join(' | ')}.`);
      }
    }
  }

  const hasBitrix = pkg.rawConversations.bitrix.length > 0;
  const hasChatbox = pkg.rawConversations.chatbox.length > 0;
  if (hasBitrix || hasChatbox) {
    lines.push('');
    lines.push('Переписка за день (Битрикс/чатбокс):');
    const pushSessions = (label: string, sessions: DayCompanyRawSession[]): void => {
      for (const s of sessions) {
        lines.push(`  ${label} · ${truncate(s.session, 120)}:`);
        for (const t of s.turns) {
          const time = t.ts ? truncate(t.ts, 20) : '';
          const who = `${truncate(t.author, 60)}${t.isClient ? ' (клиент)' : ''}`;
          lines.push(`    ${who} [${time}]: ${truncate(t.text, 300)}`);
        }
      }
    };
    if (hasBitrix) pushSessions('Битрикс', pkg.rawConversations.bitrix);
    if (hasChatbox) pushSessions('Чатбокс', pkg.rawConversations.chatbox);
  }

  const hasSignals =
    pkg.signals.blockers.length > 0 ||
    pkg.signals.risks.length > 0 ||
    pkg.signals.ideas.length > 0;
  if (hasSignals) {
    lines.push('');
    lines.push('Сигналы графа:');
    for (const b of pkg.signals.blockers) {
      lines.push(`  - блокер: ${truncate(b.text, 200)} (уверенность ${pct(b.confidence)}).`);
    }
    for (const r of pkg.signals.risks) {
      const cause = r.causeCategory ? `, причина ${truncate(r.causeCategory, 60)}` : '';
      lines.push(
        `  - риск: ${truncate(r.text, 200)} (${truncate(r.dynamicLabel, 60)}${cause}, наблюдений ${r.observations}).`,
      );
    }
    for (const i of pkg.signals.ideas) {
      const cluster = i.clusterId ? `, кластер ${truncate(i.clusterId, 40)}` : '';
      lines.push(
        `  - идея: ${truncate(i.text, 200)} (поддержали ${i.supporterCount}${cluster}).`,
      );
    }
  }

  if (pkg.conflicts.length > 0) {
    lines.push('');
    lines.push('Конфликты/трения за день:');
    for (const c of pkg.conflicts) {
      const from = truncate(c.fromPersonName ?? '—', 60);
      const to = truncate(c.toPersonName ?? '—', 60);
      lines.push(
        `  - ${from} ↔ ${to}: ${truncate(c.explanation, 240)} (уверенность ${pct(c.confidence)}).`,
      );
    }
  }

  const rep = pkg.reporting;
  const hasReporting =
    rep.planSubmitted.total > 0 ||
    rep.reportSubmitted.total > 0 ||
    rep.dayPlan.total > 0 ||
    rep.tasksSet > 0 ||
    rep.tasksDone > 0 ||
    rep.perPerson.length > 0 ||
    rep.noReport.length > 0;
  if (hasReporting) {
    lines.push('');
    lines.push('Отчётность (готовые числа — БЕРИ КАК ЕСТЬ, не пересчитывай):');
    lines.push(
      `  план сдали ${rep.planSubmitted.done} из ${rep.planSubmitted.total}; ` +
        `отчёт сдали ${rep.reportSubmitted.done} из ${rep.reportSubmitted.total}; ` +
        `план дня ${rep.dayPlan.done} из ${rep.dayPlan.total}; ` +
        `поставлено задач ${rep.tasksSet}, выполнено ${rep.tasksDone}.`,
    );
    for (const p of rep.perPerson) {
      const plan = p.planSubmitted ? '✓' : '✗';
      const report = p.reportSubmitted ? '✓' : '✗';
      const mismatch = p.mismatchReason ? `, причина: ${truncate(p.mismatchReason, 160)}` : '';
      lines.push(
        `  - ${truncate(p.personName, 80)}: план ${plan}, отчёт ${report}, ` +
          `планировал ${p.planned} сделал ${p.done}${mismatch}.`,
      );
    }
    if (rep.noReport.length > 0) {
      lines.push(`  без отчёта: ${rep.noReport.map((n) => truncate(n, 60)).join(', ')}.`);
    }
  }

  lines.push('');
  if (pkg.yesterdayOpenSignals.length > 0) {
    lines.push('Вчерашние открытые сигналы (для петли и динамики):');
    for (const s of pkg.yesterdayOpenSignals) {
      lines.push(
        `  - ${truncate(s.text, 200)} (ось ${truncate(s.axis, 40)}, состояние ${truncate(s.state, 40)}).`,
      );
    }
  } else {
    lines.push('Вчерашнего отчёта нет — петлю и динамику не строй.');
  }

  lines.push('');
  lines.push('Верни строго JSON по схеме (см. system).');
  return lines.join('\n');
}

export function dayCompanyToBodyMarkdown(
  verdict: DailyDigestVerdictDto,
  letter: DailyDigestLetterSectionDto[],
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
