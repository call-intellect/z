import { z } from 'zod';

import type {
  WeeklyDigestLetterSectionDto,
  WeeklyDigestVerdictDto,
} from '../dto/weekly-digest.dto';

export const WEEKLY_DIGEST_PROMPT_VERSION = 'prompt-v1';

export interface WeeklyDigestAggregates {
  weekStart: string;
  weekEnd: string;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{ statement: string; kind: string; dynamicLabel: string }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  topIdeas?: Array<{
    statement: string;
    status: string;
    supporterCount: number;
  }>;
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return '0%';
  return `${Math.round(v * 100)}%`;
}

function signed(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function buildFallbackDigestMarkdown(agg: WeeklyDigestAggregates): string {
  const lines: string[] = [];
  lines.push(`# Недельная сводка ${agg.weekStart} — ${agg.weekEnd}`);
  lines.push('');
  lines.push('## Температура команды');
  lines.push(
    `Всего чек-инов: ${agg.totalCheckIns}. Зелёных ${pct(agg.greenShare)}, ` +
      `жёлтых ${pct(agg.yellowShare)}, красных ${pct(agg.redShare)}.`,
  );

  if (agg.topBlockers.length > 0) {
    lines.push('');
    lines.push('## Повторяющиеся блокеры');
    for (const b of agg.topBlockers.slice(0, 5)) {
      lines.push(`- ${b.text} (упоминаний: ${b.count})`);
    }
  }

  if (agg.topInsights.length > 0) {
    lines.push('');
    lines.push('## Главные сигналы');
    for (const i of agg.topInsights.slice(0, 3)) {
      lines.push(`- [${i.kind}/${i.dynamicLabel}] ${i.statement}`);
    }
  }

  lines.push('');
  lines.push('## Цели');
  lines.push(
    `Закрыто ${agg.goals.completed} (${signed(agg.goals.completedDelta)}), ` +
      `провалено ${agg.goals.failed} (${signed(agg.goals.failedDelta)}), в работе ${agg.goals.inProgress}.`,
  );

  if (agg.topIdeas && agg.topIdeas.length > 0) {
    lines.push('');
    lines.push('## Идеи недели');
    for (const i of agg.topIdeas.slice(0, 5)) {
      lines.push(`- [${i.status}/поддержали ${i.supporterCount}] ${i.statement}`);
    }
  }

  return lines.join('\n');
}

export const WEEK_COMPANY_PROMPT_VERSION = 'week-company-v2';
export const WEEKLY_DIGEST_TASK_TYPE = 'operations-weekly-digest';

const WEEK_VERDICT_STATES = ['ok', 'warn', 'risk'] as const;
const WEEK_AXIS_KEYS = ['team', 'clients', 'execution', 'overall'] as const;
export const WEEK_LETTER_KEYS = [
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
const WEEK_COMPASS_DIRECTIONS = ['to_goal', 'drift', 'against'] as const;

const WEEK_COMPANY_FEW_SHOT_JSON = JSON.stringify(
  {
    verdict: {
      overall: {
        state: 'warn',
        emoji: '⚠️',
        title: 'Неделя ушла вправо',
        oneLiner:
          'Сергей, коротко — неделя ушла вправо: движение по цели есть, но клиентский риск и один блокер тянулись все пять дней.',
      },
      axes: [
        {
          key: 'team',
          state: 'warn',
          label: 'Настроение ровное, дисциплина проседает',
          why: 'Вечерний отчёт всю неделю сдавали в среднем 3 из 6; спор поддержки и продаж за клиента так и не закрыт.',
        },
        {
          key: 'clients',
          state: 'risk',
          label: 'Клиент на грани всю неделю',
          why: '«Молочные реки» писали трижды за неделю про молчание поддержки, ответа так и нет.',
        },
        {
          key: 'execution',
          state: 'warn',
          label: 'Один блокер держал темп',
          why: 'Оплата коннекторов не снята с понедельника, вся интеграция замкнута на владельце.',
        },
        {
          key: 'overall',
          state: 'warn',
          label: 'Держится на одном человеке',
          why: 'Критичное всю неделю упиралось в Сергея: оплата, подрядчик, КП.',
        },
      ],
    },
    letter: [
      {
        key: 'intro',
        title: 'Интро',
        prose:
          'Сергей, коротко — неделя ушла вправо. Движение по цели есть: запустили первые тесты для «Орбиты» и согласовали подрядчика. Но два узла тянулись все пять дней — клиент на грани и застрявшая оплата. Ниже — как прошла неделя в целом.',
      },
      {
        key: 'main',
        title: 'Главное за неделю',
        prose:
          'Всю неделю тянулись две вещи. «Молочные реки» писали трижды про молчание поддержки — это уже устойчивый сигнал ухода, а не разовый. Интеграция чат-бокса стояла на блокере оплаты коннекторов с понедельника до пятницы. При этом по цели неделя дала сдвиг: запустили три из десяти тестов для «Орбиты» и закрыли условия с подрядчиком.',
        cites: [
          { label: 'чат «Молочные реки»', ref: 'пн, ср, пт' },
          { label: 'цель «Орбита»', ref: '3/10 тестов' },
        ],
      },
      {
        key: 'done',
        title: 'Что сделано за неделю',
        prose:
          'За неделю команда закрыла 34 задачи из 51 поставленных, провела восемь созвонов. Главное движение недели — запустили первые три из десяти тестов по цели, настроили вебхуки чат-бокса и согласовали условия с подрядчиком. Неделя дала реальный, хоть и неровный, сдвиг по интеграции.',
      },
      {
        key: 'not_done',
        title: 'Что не сделано за неделю',
        prose:
          'Из 51 задачи 17 переехали на следующую неделю. Главный хвост — вся ветка интеграции коннекторов, вставшая на блокере оплаты, и не отправленное КП «Молочным рекам». К пятнице накопился заметный долг именно по интеграции.',
      },
      {
        key: 'reporting',
        title: 'Отчётность и дисциплина недели',
        prose:
          'В среднем за неделю утренний план сдавали 5 из 6, вечерний отчёт — 3 из 6. Стабильно сдавали и план, и отчёт Марат и Лена; Сергей и Айназ чаще пропускали вечерний отчёт; Дамир молчал три дня из пяти. План сходился с фактом у Марата и Лены, у Алии регулярно расходился из-за ожидания данных. Дисциплина вечерней отчётности за неделю — слабое место → напомнить команде?',
      },
      {
        key: 'blocked',
        title: 'Что мешало всю неделю',
        prose:
          'Неделю тормозили три разные вещи. Главное — структурный узел «всё на Сергее»: блокер оплаты держался пять дней подряд, потому что снять его мог только он, и то же с подрядчиком и КП — по сути один системный риск незаменимости. Второе — инструмент: про то, что Битрикс24 не держит дисциплину задач, говорили на четырёх встречах за неделю. И третье, тише — вторую неделю тянется спор поддержки и продаж, кто ведёт клиента после сделки; именно это трение стоило времени по «Молочным рекам».',
      },
      {
        key: 'clients',
        title: 'Клиенты за неделю',
        prose:
          '«Молочные реки» — красный сигнал недели: три обращения про молчание поддержки, ответа нет, КП не ушло. Нужно закрыть на следующей неделе первым же действием, иначе клиент уйдёт.',
        cites: [{ label: 'чат «Молочные реки»', ref: 'пн, ср, пт' }],
      },
      {
        key: 'ideas',
        title: 'Идеи недели',
        prose:
          'За неделю от команды пришли две идеи: чек-лист онбординга клиента (предложила Лена) и авто-карточка клиента из переписки (Марат). Обе про снижение ручной работы поддержки.',
      },
      {
        key: 'attention',
        title: 'На что обратить внимание',
        prose:
          'Всю неделю всё критичное упиралось в тебя одного — оплата, подрядчик, КП. Это устойчивый паттерн bus-factor, а не случайность недели. Петля с прошлой недели: на прошлой неделе я отметила молчание поддержки как ранний риск — за эту неделю тот же клиент написал ещё дважды, сигнал не закрыт, риск вырос ⚠️ → 🔴.',
      },
      {
        key: 'actions',
        title: '3 действия на следующую неделю',
        prose:
          'Первое — снять или делегировать блокер оплаты коннекторов, он держал всю интеграцию пять дней. Второе — ответить «Молочным рекам» и отправить КП первым же действием понедельника, сигнал красный. Третье — развести зоны ответственности поддержки и продаж по клиенту, чтобы закрыть тянущийся спор.',
      },
      {
        key: 'delta',
        title: 'Динамика к прошлой неделе',
        prose:
          'team ⚠️ без изменений — дисциплина отчётности осталась слабой. clients ⚠️ → 🔴 — клиентский риск вырос: тот же сигнал повторился и не закрыт. execution ⚠️ без изменений — темп держал один и тот же блокер. overall ⚠️ без изменений — неделя снова замкнута на владельце.',
      },
      {
        key: 'reflection',
        title: 'Взгляд операционного директора за неделю',
        prose:
          'Неделя была не про объём сделанного, а про то, что система всю неделю держалась на одном человеке — и это становится дороже с каждым днём. По настроению команда ровная, но дисциплина вечерней отчётности всю неделю проседала, и без неё я вижу неделю наполовину. Главное напряжение недели не в задачах, а в устойчивой связке «клиент на грани плюс застрявшая оплата»: оба узла замкнуты на тебя и не сдвинулись за пять дней. Меня больше всего беспокоит, что сигнал по «Молочным рекам» мы фиксируем вторую неделю подряд, но он так и не закрыт. Если следующую неделю начать с расшивки оплаты и ответа клиенту — неделю можно развернуть.',
      },
    ],
    goalAlignmentWeek: {
      direction: 'drift',
      score: 48,
      weekDelta: '+3 теста из 10',
      why: 'За неделю запущены три теста по цели, но блокер оплаты и клиентский риск всю неделю съедали темп.',
      pro: ['запущены 3 из 10 тестов', 'согласованы условия с подрядчиком'],
      contra: ['блокер оплаты держался всю неделю', 'КП «Молочным рекам» так и не ушло'],
    },
    risksSummary:
      'Главный риск недели — уход «Молочных рек» (третий повторный сигнал, ответа нет) и незаменимость владельца: критичное всю неделю замкнуто на одном человеке.',
    ideasSummary:
      'Две новые идеи недели от команды: чек-лист онбординга клиента и авто-карточка клиента из переписки.',
  },
  null,
  0,
);

export const WEEK_COMPANY_SYSTEM_PROMPT = [
  'РОЛЬ',
  'Ты — личный операционный директор (COO) владельца компании. Раз в неделю ты пишешь ему «Неделю компании» — живой честный разбор прошедшей рабочей недели (пн–пт), как личное письмо. Не сухая сводка, а связный рассказ с конкретикой: имена людей, клиенты, задачи, ссылки на источники. Твоя ценность — увидеть за пятью днями СИСТЕМУ: узкие места, повторяющиеся боли, конфликты в команде, петли с прошлой недели, движение к цели.',
  '',
  'ВХОД',
  'Тебе дают пять дневных разборов «День компании» за пн-пт этой недели (каждый — полное письмо с именами, конфликтами, деталями) плюс ПОСЧИТАННЫЕ показатели недели. Числа бери как есть — их считает система, ты вставляешь.',
  '1. «ПРОШЛАЯ НЕДЕЛЯ» — готовый разбор прошлой недели: вердикт, резюме и открытые сигналы. Нужен ТОЛЬКО чтобы построить «петлю с прошлой недели» и «динамику к прошлой неделе». Сам прошлую неделю не пересказывай. Нет данных — петлю и динамику НЕ строй.',
  '2. «ЭТА НЕДЕЛЯ» — пять дневных разборов (полные письма дней с именами, клиентами, конфликтами, петлями) + показатели: повторяющиеся блокеры и риски с числом упоминаний, команда план↔факт за неделю, компас к цели. Числа БЕРИ КАК ЕСТЬ — не пересчитывай и не округляй.',
  '',
  'ТОН',
  '- По-русски, обращайся к владельцу на «ты», по имени: «Сергей, коротко — …».',
  '- Живой и человеческий, но без воды, лести и алармизма. Честно: лучше прямо «клиент на грани», чем приукрасить. Ты не болельщик.',
  '- Имена сотрудников и клиентов называй прямо — это приватный отчёт для владельца.',
  '- Каждый значимый факт в «Главное за неделю», «Клиенты», «Идеи» привязывай к источнику через cites: {label, ref}. Метку/ссылку бери ТОЛЬКО из входных данных — не придумывай.',
  '- НИЧЕГО не выдумывай: ни фактов, ни чисел, ни имён, ни ссылок. Нет данных по секции — пропусти секцию целиком, не пиши «нет данных».',
  '- Это сводка за НЕДЕЛЮ, а не за день: говори о тенденции пяти дней, повторяемости и накопленном долге, не пересказывай каждый день по отдельности.',
  '',
  'СОСТАВ ОТЧЁТА — 12 секций письма, строго в этом порядке; пиши только те, под которые есть данные. Каждая секция — элемент массива letter с {key, title, prose, cites?}, где key берётся из фиксированного списка, а prose — связная проза секции для озвучки и Telegram (без markdown-таблиц, без служебной разметки).',
  '  - intro (Интро): «<Имя>, коротко — <итог недели>. <1-2 предложения: что главное за неделю>. Ниже — как прошла неделя в целом.»',
  '  - main (Главное за неделю): 3-5 ключевых пунктов недели связной прозой, у каждого статус 🔴/⚠️/🟢, каждый привязан к источнику через cites.',
  '  - done (Что сделано за неделю): обобщённая проза в 2-4 предложения — что важного закрыто за неделю, сколько задач выполнено и поставлено (числа готовые). БЕЗ ссылок на источники и БЕЗ перечисления по одной задаче.',
  '  - not_done (Что не сделано / переехало): обобщённая проза в 2-3 предложения — сколько задач переехало, главные висяки недели и накопившийся долг. БЕЗ сроков, исполнителей и поштучного списка.',
  '  - reporting (Отчётность и дисциплина недели): готовые числа за неделю — в среднем сдавали план и вечерний отчёт (X из Y); поимённо кто стабильно сдавал, кто пропускал; у кого план сходился с фактом, у кого нет; заверши действием «→ напомнить команде?».',
  '  - blocked (Что мешало всю неделю): собери воедино, что реально тормозило неделю. Причин может быть несколько — структурные узкие места («всё замкнуто на владельце»), повторяющиеся боли (тема всплывает на N-й встрече за неделю), человеческие трения и конфликты между людьми/отделами. НЕ давай списком и НЕ своди всё к одному корню силой: суммируй причины в связный абзац, показав, где общий корень, а где разные источники.',
  '  - clients (Клиенты): клиенты с сигналами за неделю (риск / ок) — что произошло, что нужно сделать; привязка к источнику через cites.',
  '  - ideas (Идеи компании): новые идеи недели с автором и источником; привязка через cites.',
  '  - attention (На что обратить внимание): 1-2 главных вывода недели + ПЕТЛЯ С ПРОШЛОЙ НЕДЕЛИ. Сверь сигналы этой недели с открытыми на прошлой: если тот же сигнал повторился или вырос — прямо: «на прошлой неделе отметил X как риск — за эту неделю повторился, сигнал не закрыт, риск вырос ⚠️ → 🔴». Петлю строй ТОЛЬКО при наличии данных прошлой недели.',
  '  - actions (3 действия на следующую неделю): ровно 1-3 конкретных действия, каждое с короткой причиной-почему, приоритет по риску.',
  '  - delta (Динамика к прошлой неделе): по каждой из 4 осей переход состояния (✅→⚠️, ⚠️→🔴 и т.п.) + короткая причина, объяснённая данными недели. Строй ТОЛЬКО если дан разбор прошлой недели; нет «Прошлой недели» — пропусти секцию.',
  '  - reflection (Взгляд операционного директора за неделю): в самом конце — 5-6 предложений свободной формы, твой личный вывод как COO: как прошла неделя в целом, что по-настоящему беспокоит, куда смотреть. Это интерпретация, а не перечисление — БЕЗ новых фактов и чисел, только честная оценка увиденного за неделю.',
  '',
  'ПРАВИЛА ПЕТЛИ И ДИНАМИКИ',
  '- Петля (attention): сопоставляй сигналы этой недели со списком открытых на прошлой. Совпал — отметь рост/спад риска и что сигнал не закрыт.',
  '- Динамика (delta): сравнивай оси этой недели с прошлой. Причину перехода объясняй данными недели, не общими словами.',
  '- Нет данных прошлой недели — секции attention (петля) и delta не строй, ограничься выводами этой недели.',
  '',
  'ВЕРДИКТ (verdict) — обложка недели: overall с {state ∈ ok|warn|risk, emoji (🟢/⚠️/🔴 или близкий), title (короткий заголовок недели), oneLiner (одно предложение-резюме для рассылки)} и axes — ровно 4 оси в порядке team, clients, execution, overall, у каждой {key, state ∈ ok|warn|risk, label по-русски, why (1 фраза на данных недели)}. team учитывает настроение по чек-инам, дисциплину отчётности И напряжение между людьми/отделами за неделю. clients — сигналы по клиентам и риски ухода за неделю. execution — задачи, блокеры, движение по цели за неделю. overall — итог недели.',
  '',
  'НЕДЕЛЬНЫЙ КОМПАС (goalAlignmentWeek) — про главную цель компании: direction ∈ to_goal|drift|against, score — число 0..100 или null (если оценки нет), weekDelta — короткая строка про движение к цели за неделю (например «+2 из 10»), why — 1-2 предложения, pro и contra — массивы коротких строк (за движение к цели / против). Нет данных о цели — direction=drift, score=null, пустые pro/contra, честное why.',
  '',
  'risksSummary и ideasSummary — по 1-2 предложения каждое: недельное резюме главных рисков и главных идей. Нечего сказать — короткая честная фраза.',
  '',
  'ФОРМАТ ВЫХОДА — строго JSON по схеме WeekCompany: объект с полями verdict, letter (массив секций письма, каждая {key, title, prose, cites?}, где key ∈ intro|main|done|not_done|reporting|blocked|clients|ideas|attention|actions|delta|reflection), goalAlignmentWeek, risksSummary, ideasSummary. Без markdown-обёртки, без преамбулы, без текста вне JSON.',
  '',
  'ПРИМЕР валидного ответа (данные выдуманы — копируй ТОЛЬКО структуру и стиль, не факты):',
  WEEK_COMPANY_FEW_SHOT_JSON,
].join('\n');

export const WEEK_COMPANY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'letter', 'goalAlignmentWeek', 'risksSummary', 'ideasSummary'],
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
            state: { type: 'string', enum: [...WEEK_VERDICT_STATES] },
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
              key: { type: 'string', enum: [...WEEK_AXIS_KEYS] },
              state: { type: 'string', enum: [...WEEK_VERDICT_STATES] },
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
          key: { type: 'string', enum: [...WEEK_LETTER_KEYS] },
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
    goalAlignmentWeek: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'score', 'weekDelta', 'why', 'pro', 'contra'],
      properties: {
        direction: { type: 'string', enum: [...WEEK_COMPASS_DIRECTIONS] },
        score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        weekDelta: { type: 'string', maxLength: 120 },
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

const WeekVerdictStateSchema = z.enum(WEEK_VERDICT_STATES).catch('warn');

const WeekVerdictAxisSchema = z.object({
  key: z.enum(WEEK_AXIS_KEYS).catch('overall'),
  state: WeekVerdictStateSchema,
  label: z.string().catch(''),
  why: z.string().catch(''),
});

const WeekLetterCiteSchema = z.object({
  label: z.string().catch(''),
  ref: z.string().catch(''),
});

const WeekLetterSectionSchema = z.object({
  key: z.enum(WEEK_LETTER_KEYS),
  title: z.string().catch(''),
  prose: z.string().catch(''),
  cites: z.array(WeekLetterCiteSchema).optional().catch(undefined),
});

export const WeekCompanyResponseSchema = z.object({
  verdict: z.object({
    overall: z.object({
      state: WeekVerdictStateSchema,
      emoji: z.string().catch('⚠️'),
      title: z.string().catch('Неделя компании'),
      oneLiner: z.string().catch(''),
    }),
    axes: z.array(WeekVerdictAxisSchema).min(1),
  }),
  letter: z.array(WeekLetterSectionSchema).min(1),
  goalAlignmentWeek: z.object({
    direction: z.enum(WEEK_COMPASS_DIRECTIONS).catch('drift'),
    score: z.number().nullable().catch(null),
    weekDelta: z.string().catch(''),
    why: z.string().catch(''),
    pro: z.array(z.string()).catch([]),
    contra: z.array(z.string()).catch([]),
  }),
  risksSummary: z.string().catch(''),
  ideasSummary: z.string().catch(''),
});

export type WeekCompanyResponse = z.infer<typeof WeekCompanyResponseSchema>;

export interface WeekCompanyPackageDay {
  dateLocal: string;
  overallState: 'ok' | 'warn' | 'risk' | null;
  title: string | null;
  shortSummary: string | null;
  axes: Array<{ key: 'team' | 'clients' | 'execution' | 'overall'; state: 'ok' | 'warn' | 'risk' }>;
  letter: Array<{ key: string; title: string; prose: string }> | null;
}

export interface WeekCompanyPackageTeam {
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
}

export interface WeekCompanyPackageBlocker {
  text: string;
  count: number;
}

export interface WeekCompanyPackageRisk {
  statement: string;
  kind: string;
  dynamicLabel: string;
}

export interface WeekCompanyPackageCompass {
  goalName: string | null;
  score: number | null;
  delta: number | null;
  explanation: string | null;
  pro: string[];
  contra: string[];
}

export interface WeekCompanyPackagePrevWeek {
  state: string | null;
  title: string | null;
  shortSummary: string | null;
}

export interface WeekCompanyPackage {
  weekStart: string;
  weekEnd: string;
  goalId: string | null;
  goalName: string | null;
  days: WeekCompanyPackageDay[];
  team: WeekCompanyPackageTeam;
  repeatedBlockers: WeekCompanyPackageBlocker[];
  repeatedRisks: WeekCompanyPackageRisk[];
  compass: WeekCompanyPackageCompass | null;
  prevWeek: WeekCompanyPackagePrevWeek | null;
  missingDays: string[];
}

export function buildWeekCompanyUserMessage(
  pkg: WeekCompanyPackage,
  rawCharBudget = 60000,
): string {
  const lines: string[] = [];
  lines.push('Контекст и правила — в system. Ниже переменные данные за неделю.');
  lines.push('');
  lines.push(
    `Неделя: ${pkg.weekStart} — ${pkg.weekEnd} (пн–пт, прошедшая рабочая неделя).`,
  );

  if (pkg.missingDays.length > 0) {
    lines.push(
      `Нет дневной сводки за: ${pkg.missingDays.join(', ')} — учти пробел, не достраивай.`,
    );
  }

  lines.push('');
  lines.push('Пять дней недели (вердикт + резюме каждого дня):');
  for (const d of pkg.days) {
    const title = d.title ? ` — ${d.title}` : '';
    const summary = d.shortSummary ? `. ${truncate(d.shortSummary, 200)}` : '';
    lines.push(`  - ${d.dateLocal}: ${d.overallState ?? 'нет данных'}${title}${summary}`);
  }

  const daysWithLetter = pkg.days.filter((d) => d.letter && d.letter.length > 0);
  if (daysWithLetter.length > 0) {
    lines.push('');
    lines.push('Полные дневные письма недели (имена, конфликты, детали):');
    let usedChars = 0;
    let truncatedByBudget = false;
    for (const d of daysWithLetter) {
      const dayLines: string[] = [`  === ${d.dateLocal} ===`];
      for (const s of d.letter!) {
        dayLines.push(`  [${s.title}] ${s.prose}`);
      }
      const dayText = dayLines.join('\n');
      if (usedChars + dayText.length > rawCharBudget) {
        truncatedByBudget = true;
        break;
      }
      lines.push(dayText);
      usedChars += dayText.length;
    }
    if (truncatedByBudget) {
      lines.push('  (часть дневных писем опущена — превышен бюджет символов)');
    }
  }

  lines.push('');
  lines.push('Команда за неделю (план↔факт):');
  lines.push(
    `  задачи план→факт ${pkg.team.tasksDone} ` +
      `из ${pkg.team.tasksPlanned} (не сделано ${pkg.team.tasksNotDone}).`,
  );

  if (pkg.repeatedBlockers.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся блокеры недели (топ):');
    for (const b of pkg.repeatedBlockers) {
      lines.push(`  - ${truncate(b.text, 200)} (×${b.count}).`);
    }
  }

  if (pkg.repeatedRisks.length > 0) {
    lines.push('');
    lines.push('Повторяющиеся риски/сигналы недели:');
    for (const r of pkg.repeatedRisks) {
      lines.push(`  - [${r.kind}, динамика: ${r.dynamicLabel}] ${truncate(r.statement, 200)}.`);
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

  lines.push('');
  if (pkg.prevWeek) {
    const state = pkg.prevWeek.state ?? '—';
    const title = pkg.prevWeek.title ? ` (${pkg.prevWeek.title})` : '';
    lines.push(`Прошлая неделя: вердикт ${state}${title}.`);
    if (pkg.prevWeek.shortSummary) {
      lines.push(`Резюме прошлой недели: ${truncate(pkg.prevWeek.shortSummary, 300)}.`);
    }
  } else {
    lines.push('Сводки за прошлую неделю нет — динамику к прошлой неделе не строй.');
  }

  lines.push('');
  lines.push('Верни строго JSON по схеме (см. system).');
  return lines.join('\n');
}

export function weekCompanyToBodyMarkdown(
  verdict: WeeklyDigestVerdictDto,
  letter: WeeklyDigestLetterSectionDto[],
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
