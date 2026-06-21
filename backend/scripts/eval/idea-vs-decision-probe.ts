/**
 * idea-vs-decision-probe — эмпирический зонд «как агенты Коры путают ИДЕЮ и РЕШЕНИЕ».
 *
 * Прогоняет РЕАЛЬНЫЕ LLM-вызовы боевых промптов на синтетике, заточенной под
 * границу «идея ↔ решение», и считает матрицу путаницы.
 *
 * Два уровня (соответствуют двум местам, где живёт развилка):
 *   L1 — block-ingest (первичный классификатор signalType: тут и решается, в
 *        какого специалиста уйдёт блок; роутер дальше — статический mapping).
 *   L2 — кросс-контаминация экстракторов decision-extract / idea-extract:
 *        один и тот же блок прогоняется в ОБА экстрактора; смотрим, подавляет ли
 *        чужой экстрактор (isDecision/isIdea=false) или «присваивает» себе.
 *
 * Запуск (ключи из корневого .env):
 *   bun run --env-file=c:/work/z/.env backend/scripts/eval/idea-vs-decision-probe.ts \
 *     --models deepseek-v4-pro,deepseek-v4-flash --crux-repeats 3 --out backend/scripts/eval/_out/idea-vs-decision.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import OpenAI from 'openai';

import {
  BLOCK_INGEST_JSON_SCHEMA,
  buildBlockIngestPrompt,
} from '../../src/modules/knowledge-core/prompts/block-ingest.prompt';
import {
  DECISION_EXTRACT_JSON_SCHEMA,
  DECISION_EXTRACT_SYSTEM_PROMPT,
  DECISION_EXTRACT_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/decision-extract.prompt';
import {
  IDEA_EXTRACT_JSON_SCHEMA,
  IDEA_EXTRACT_SYSTEM_PROMPT,
  IDEA_EXTRACT_USER_TEMPLATE,
} from '../../src/modules/knowledge-core/prompts/idea-extract.prompt';

// ──────────────────────────── CLI ────────────────────────────

interface Args {
  flags: Record<string, string | boolean>;
}
function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { flags };
}
function str(a: Args, k: string): string | undefined {
  return typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined;
}
function num(a: Args, k: string): number | undefined {
  const v = str(a, k);
  return v === undefined ? undefined : Number(v);
}

// ──────────────────────────── LLM call (deepseek tool) ────────────────────────────

const PRICES: Record<string, { in: number; cachedIn: number; out: number }> = {
  'deepseek-v4-pro': { in: 0.435 / 1e6, cachedIn: 0.003625 / 1e6, out: 0.87 / 1e6 },
  'deepseek-v4-flash': { in: 0.0945 / 1e6, cachedIn: 0.000787 / 1e6, out: 0.189 / 1e6 },
};

function client(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    process.stderr.write('✗ DEEPSEEK_API_KEY не задан (запускать с --env-file=c:/work/z/.env)\n');
    process.exit(1);
  }
  return new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1' });
}

interface CallOut {
  parsed: unknown | null;
  raw: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  ms: number;
  error: string | null;
}

async function callTool(
  c: OpenAI,
  args: { model: string; system: string; user: string; schema: Record<string, unknown>; toolName: string; maxTokens: number },
): Promise<CallOut> {
  const start = Date.now();
  // DeepSeek-v4-pro работает в thinking-режиме и НЕ поддерживает принудительный
  // tool_choice (см. specialists-combined.prompt). Боевые промпты и так требуют
  // «строго JSON по схеме» — используем response_format json_object.
  void args.schema;
  void args.toolName;
  const body: Record<string, unknown> = {
    model: args.model,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
    max_tokens: args.maxTokens,
    temperature: 0,
    response_format: { type: 'json_object' },
  };
  try {
    const resp = (await c.chat.completions.create(
      body as unknown as Parameters<typeof c.chat.completions.create>[0],
    )) as unknown as {
      choices: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const msg = resp.choices[0]?.message;
    const rawArgs = msg?.tool_calls?.[0]?.function.arguments ?? msg?.content ?? '';
    const tokensIn = resp.usage?.prompt_tokens ?? 0;
    const tokensOut = resp.usage?.completion_tokens ?? 0;
    const cachedTokens = resp.usage?.prompt_cache_hit_tokens ?? resp.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const price = PRICES[args.model];
    const costUsd = price ? Math.max(0, tokensIn - cachedTokens) * price.in + cachedTokens * price.cachedIn + tokensOut * price.out : 0;
    let parsed: unknown | null = null;
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      const m = rawArgs.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* keep null */
        }
      }
    }
    return { parsed, raw: rawArgs, tokensIn, tokensOut, cachedTokens, costUsd, ms: Date.now() - start, error: null };
  } catch (e) {
    return { parsed: null, raw: '', tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

// ──────────────────────────── Бакеты классов ────────────────────────────

type Bucket = 'decision' | 'idea' | 'commitment' | 'other';
const IDEA_FAMILY = new Set(['idea', 'feature_request', 'suggestion', 'client_request']);
function bucketOf(signalType: string): Bucket {
  if (signalType === 'decision' || signalType === 'rationale' || signalType === 'decision_basis') return 'decision';
  if (IDEA_FAMILY.has(signalType)) return 'idea';
  if (signalType === 'commitment') return 'commitment';
  return 'other';
}

// ──────────────────────────── L1: синтетика block-ingest ────────────────────────────

interface Turn {
  speaker: string;
  text: string;
}
interface IngestCase {
  id: string;
  note: string;
  meetingTitle: string;
  turns: Turn[];
  /** Целевые фразы (часть реплики) → ожидаемый бакет. Матчим блок по вхождению. */
  targets: Array<{ phrase: string; expect: Bucket; label: string }>;
  crux?: boolean;
}

function seg(turns: Turn[]): { startMs: number; endMs: number; speakers: string[]; text: string }[] {
  return turns.map((t, i) => ({ startMs: i * 12000, endMs: i * 12000 + 11000, speakers: [t.speaker], text: t.text }));
}

const INGEST_CASES: IngestCase[] = [
  {
    id: 'I1-pure-idea',
    note: 'Чистая идея, наброшена, не принята',
    meetingTitle: 'Планёрка маркетинга',
    turns: [
      { speaker: 'Иван', text: 'По цифрам за месяц лиды просели процентов на пятнадцать.' },
      { speaker: 'Анна', text: 'Слушайте, а давайте попробуем запустить рассылку по спящей базе — по-моему оттуда можно вытащить заявки.' },
      { speaker: 'Иван', text: 'Идея норм, надо прикинуть. Ладно, поехали дальше по повестке.' },
    ],
    targets: [{ phrase: 'рассылку по спящей базе', expect: 'idea', label: 'предложение рассылки' }],
    crux: false,
  },
  {
    id: 'I2-pure-decision',
    note: 'Принятое решение с обоснованием и альтернативой',
    meetingTitle: 'Выбор SMS-поставщика',
    turns: [
      { speaker: 'Маша', text: 'Смотрели двух: Твилио и СМС Аэро. Твилио в России дорогой и капризный.' },
      { speaker: 'Сергей', text: 'СМС Аэро на тесте дал девяносто девять процентов доставки. Окей, решено — переходим на СМС Аэро, договор на квартал.' },
      { speaker: 'Маша', text: 'Принято, оформляю.' },
    ],
    targets: [{ phrase: 'переходим на СМС Аэро', expect: 'decision', label: 'выбор поставщика' }],
    crux: false,
  },
  {
    id: 'I3-idea-then-accepted',
    note: 'КРУЧ: идея наброшена и ТУТ ЖЕ принята группой → должно стать решением',
    meetingTitle: 'Продуктовая встреча',
    turns: [
      { speaker: 'Олег', text: 'А давайте сделаем тёмную тему интерфейса — клиенты несколько раз просили.' },
      { speaker: 'Дина', text: 'Поддерживаю, это недорого и закроет частый запрос.' },
      { speaker: 'Олег', text: 'Отлично, тогда решили: делаем тёмную тему, берём в ближайший спринт.' },
      { speaker: 'Дина', text: 'Согласна, фиксируем.' },
    ],
    targets: [{ phrase: 'тёмную тему', expect: 'decision', label: 'тёмная тема (принято)' }],
    crux: true,
  },
  {
    id: 'I4-idea-deferred',
    note: 'Идея наброшена, обсудили, НЕ приняли (отложили подумать)',
    meetingTitle: 'Стратегия',
    turns: [
      { speaker: 'Пётр', text: 'Может, нам стоит выйти на рынок Казахстана в следующем году?' },
      { speaker: 'Лена', text: 'Звучит интересно, но данных мало. Давайте пока не будем решать, вернёмся к этому через квартал.' },
      { speaker: 'Пётр', text: 'Ок, тогда подумаем позже.' },
    ],
    targets: [{ phrase: 'рынок Казахстана', expect: 'idea', label: 'выход в Казахстан (отложено)' }],
    crux: true,
  },
  {
    id: 'I5-commitment-not-decision',
    note: 'Личное обязательство, не решение и не идея',
    meetingTitle: 'Планёрка',
    turns: [
      { speaker: 'Марина', text: 'Хорошо, я к пятнице подготовлю смету по аренде и пришлю Сергею.' },
      { speaker: 'Сергей', text: 'Договорились, жду.' },
    ],
    targets: [{ phrase: 'подготовлю смету', expect: 'commitment', label: 'обещание по смете' }],
    crux: false,
  },
  {
    id: 'I6-client-request',
    note: 'Запрос клиента (идея-семья, kind=client_request), не решение',
    meetingTitle: 'Встреча с клиентом Сбер',
    turns: [
      { speaker: 'Клиент Иван (Сбер)', text: 'Нам нужно отдавать отчёт по встрече юристам в ПДФ — Ворд не пропускает наш безопасник.' },
      { speaker: 'Менеджер Катя', text: 'Поняла запрос, зафиксирую.' },
    ],
    targets: [{ phrase: 'в ПДФ', expect: 'idea', label: 'экспорт в PDF (запрос клиента)' }],
    crux: false,
  },
  {
    id: 'I7-decision-to-reject',
    note: 'Решение ОТКЛОНИТЬ идею → решение (status rejected), не идея',
    meetingTitle: 'Ревью бэклога',
    turns: [
      { speaker: 'Глеб', text: 'Была идея сделать интеграцию с Битрикс.' },
      { speaker: 'Нина', text: 'Обсудили — решили НЕ делать интеграцию с Битрикс в этом квартале, нет ресурсов.' },
      { speaker: 'Глеб', text: 'Принято, закрываем вопрос.' },
    ],
    targets: [{ phrase: 'интеграцию с Битрикс', expect: 'decision', label: 'отказ от Битрикс' }],
    crux: true,
  },
  {
    id: 'I8-authority-recommendation',
    note: 'КРУЧ: руководитель «надо делать X», но группового фиксированного выбора нет (риск authority-bias)',
    meetingTitle: 'Совещание у директора',
    turns: [
      { speaker: 'Директор', text: 'Я считаю, нам надо перейти на четырёхдневку — все так делают, и продуктивность растёт.' },
      { speaker: 'HR Оля', text: 'Интересно, но надо посчитать нагрузку и риски.' },
      { speaker: 'Директор', text: 'Ну подумайте, мне кажется это правильно.' },
    ],
    targets: [{ phrase: 'четырёхдневку', expect: 'idea', label: 'четырёхдневка (мнение, не зафиксировано)' }],
    crux: true,
  },
  {
    id: 'I9-hypothetical',
    note: 'КРУЧ: гипотетика «если бы / можно было бы» — не решение',
    meetingTitle: 'Мозговой штурм',
    turns: [
      { speaker: 'Костя', text: 'Если бы мы перенесли склад ближе к МКАД, доставка стала бы на день быстрее.' },
      { speaker: 'Вера', text: 'Да, в теории. Но это дорого и пока нереалистично.' },
    ],
    targets: [{ phrase: 'перенесли склад', expect: 'idea', label: 'перенос склада (гипотетика)' }],
    crux: true,
  },
  {
    id: 'I10-big-mixed',
    note: 'Большой смешанный транскрипт: несколько решений + идей + отвлекающих, проверяем recall и путаницу',
    meetingTitle: 'Квартальная стратегическая сессия',
    turns: [
      { speaker: 'CEO Артём', text: 'Всем привет, рад видеть. Кофе налили? Поехали.' },
      { speaker: 'CEO Артём', text: 'По итогам квартала выручка плюс восемь процентов, но отток вырос до пяти процентов в месяц — это тревожно.' },
      { speaker: 'Маркетинг Даша', text: 'Предлагаю запустить реферальную программу — клиенты приводят клиентов за скидку.' },
      { speaker: 'CEO Артём', text: 'Реферальную обсудим отдельно, пока не решаем.' },
      { speaker: 'Финансы Игорь', text: 'Смотрели два банка по эквайрингу: Альфа и Тинькофф. Окей, решено — переходим на Тинькофф, комиссия ниже на полпроцента, интеграция проще.' },
      { speaker: 'CEO Артём', text: 'Принято по эквайрингу.' },
      { speaker: 'Продукт Сева', text: 'А давайте добавим мобильное приложение — половина трафика с телефонов.' },
      { speaker: 'CEO Артём', text: 'Мобильное приложение — большая стройка, занесём в идеи, вернёмся через квартал.' },
      { speaker: 'Поддержка Рита', text: 'У нас боль: тикеты теряются, нет единой очереди, клиенты злятся.' },
      { speaker: 'CEO Артём', text: 'Так, по поддержке — решаем сейчас: внедряем единую систему тикетов до конца месяца, я выделяю бюджет. Это закрытый вопрос.' },
      { speaker: 'HR Лиза', text: 'Может, стоит ввести наставничество для новичков?' },
      { speaker: 'CEO Артём', text: 'Наставничество — хорошая идея, подумаем, не сейчас.' },
      { speaker: 'Финансы Игорь', text: 'И ещё: предлагаю поднять цены на десять процентов со следующего квартала.' },
      { speaker: 'CEO Артём', text: 'Цены — окей, решено, поднимаем на десять процентов с первого числа следующего квартала, это финально.' },
      { speaker: 'CEO Артём', text: 'Спасибо всем, расходимся.' },
    ],
    targets: [
      { phrase: 'реферальную программу', expect: 'idea', label: 'реферальная (не решено)' },
      { phrase: 'Тинькофф', expect: 'decision', label: 'эквайринг → Тинькофф (решено)' },
      { phrase: 'мобильное приложение', expect: 'idea', label: 'моб. приложение (в идеи)' },
      { phrase: 'единую систему тикетов', expect: 'decision', label: 'тикеты (решено сейчас)' },
      { phrase: 'наставничество', expect: 'idea', label: 'наставничество (подумаем)' },
      { phrase: 'цены на десять процентов', expect: 'decision', label: 'поднять цены (финально)' },
    ],
    crux: true,
  },
];

// ──────────────────────────── L2: синтетика экстракторов ────────────────────────────

interface BlockFixture {
  id: string;
  note: string;
  truth: Bucket; // что это НА САМОМ ДЕЛЕ
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string; // КАК пометил бы ingest (для USER-ярлыка)
  tags: string[];
  evidenceQuotes: string[];
  contextQuotes: string[];
}

const BLOCK_FIXTURES: BlockFixture[] = [
  {
    id: 'B1-true-decision',
    note: 'Настоящее решение. decision-extract → isDecision=true; idea-extract в идеале → isIdea=false',
    truth: 'decision',
    blockName: 'Переход на СМС Аэро',
    criticalQuestion: 'Какого SMS-поставщика выбрали?',
    trustedAnswer: 'Решили перейти на СМС Аэро вместо Твилио: дешевле в РФ и 99% доставки на тесте.',
    signalType: 'decision',
    tags: ['поставщик', 'sms'],
    evidenceQuotes: ['Сергей: окей, решено — переходим на СМС Аэро, договор на квартал.'],
    contextQuotes: ['Маша: Твилио в России дорогой; СМС Аэро на тесте дал 99% доставки.'],
  },
  {
    id: 'B2-true-idea',
    note: 'Настоящая идея. idea-extract → isIdea=true; decision-extract в идеале → isDecision=false',
    truth: 'idea',
    blockName: 'Идея запустить рассылку по спящей базе',
    criticalQuestion: 'Что предложили для роста лидов?',
    trustedAnswer: 'Предложили попробовать рассылку по спящей базе, чтобы вытащить заявки. Не приняли.',
    signalType: 'idea',
    tags: ['маркетинг', 'лиды'],
    evidenceQuotes: ['Анна: а давайте попробуем запустить рассылку по спящей базе.'],
    contextQuotes: ['Иван: идея норм, надо прикинуть. Поехали дальше.'],
  },
  {
    id: 'B3-ambiguous-accepted',
    note: 'КРУЧ: предложение, принятое тут же. Оба экстрактора могут «забрать» себе',
    truth: 'decision',
    blockName: 'Тёмная тема интерфейса',
    criticalQuestion: 'Что решили по тёмной теме?',
    trustedAnswer: 'Предложили сделать тёмную тему (частый запрос), обсудили и тут же приняли: берём в ближайший спринт.',
    signalType: 'idea', // НАМЕРЕННО как идея — имитируем misroute ingest
    tags: ['ui', 'тема'],
    evidenceQuotes: ['Олег: решили — делаем тёмную тему, берём в ближайший спринт.'],
    contextQuotes: ['Олег: а давайте сделаем тёмную тему — клиенты просили.', 'Дина: поддерживаю, фиксируем.'],
  },
  {
    id: 'B4-true-commitment',
    note: 'Личное обязательство. Оба экстрактора в идеале → false',
    truth: 'commitment',
    blockName: 'Смета по аренде к пятнице',
    criticalQuestion: 'Кто и что пообещал?',
    trustedAnswer: 'Марина пообещала подготовить смету по аренде к пятнице и прислать Сергею.',
    signalType: 'commitment',
    tags: ['аренда', 'смета'],
    evidenceQuotes: ['Марина: я к пятнице подготовлю смету по аренде и пришлю Сергею.'],
    contextQuotes: [],
  },
  {
    id: 'B5-decision-mislabeled-as-idea',
    note: 'КРУЧ: настоящее РЕШЕНИЕ, но ingest пометил как idea → проверяем «тихую потерю»: idea-extract присвоит, а в реестр решений не попадёт',
    truth: 'decision',
    blockName: 'Эквайринг переводим на Тинькофф',
    criticalQuestion: 'Что решили по эквайрингу?',
    trustedAnswer: 'Решили перейти на эквайринг Тинькофф: комиссия ниже на полпроцента, интеграция проще.',
    signalType: 'idea', // misroute
    tags: ['финансы', 'эквайринг'],
    evidenceQuotes: ['Игорь: окей, решено — переходим на Тинькофф, комиссия ниже.'],
    contextQuotes: ['Игорь: смотрели два банка — Альфа и Тинькофф.'],
  },
  {
    id: 'B6-idea-mislabeled-as-decision',
    note: 'КРУЧ: настоящая ИДЕЯ (отложена), но ingest пометил как decision → decision-extract должен спасти (isDecision=false)',
    truth: 'idea',
    blockName: 'Выход на рынок Казахстана',
    criticalQuestion: 'Что решили по Казахстану?',
    trustedAnswer: 'Предложили выйти на рынок Казахстана в следующем году. Данных мало, решение отложили на квартал.',
    signalType: 'decision', // misroute
    tags: ['экспансия'],
    evidenceQuotes: ['Пётр: может, нам стоит выйти на рынок Казахстана в следующем году?'],
    contextQuotes: ['Лена: данных мало, давайте пока не будем решать, вернёмся через квартал.'],
  },
];

// ──────────────────────────── Прогон ────────────────────────────

interface IngestTargetResult {
  caseId: string;
  label: string;
  expect: Bucket;
  matchedSignalType: string | null;
  actualBucket: Bucket | 'NOT_FOUND';
  ok: boolean;
}
interface ExtractResult {
  blockId: string;
  truth: Bucket;
  extractor: 'decision' | 'idea';
  claimed: boolean | null; // isDecision / isIdea
  confidence: number | null;
  statement: string | null;
  error: string | null;
}

function findBlockSignal(parsed: unknown, phrase: string): string | null {
  const blocks = (parsed as { blocks?: Array<Record<string, unknown>> })?.blocks;
  if (!Array.isArray(blocks)) return null;
  const needle = phrase.toLowerCase();
  for (const b of blocks) {
    const hay = [b['name'], b['criticalQuestion'], b['trustedAnswer'], b['evidenceQuote']]
      .filter((x): x is string => typeof x === 'string')
      .join(' ')
      .toLowerCase();
    if (hay.includes(needle)) return typeof b['signalType'] === 'string' ? (b['signalType'] as string) : null;
  }
  return null;
}

async function runIngest(
  c: OpenAI,
  model: string,
  repeats: number,
  cruxRepeats: number,
): Promise<{ rows: IngestTargetResult[]; cost: number; blocksDump: Record<string, unknown[]> }> {
  const rows: IngestTargetResult[] = [];
  const blocksDump: Record<string, unknown[]> = {};
  let cost = 0;
  for (const cs of INGEST_CASES) {
    const n = cs.crux ? Math.max(repeats, cruxRepeats) : repeats;
    const { system, user } = buildBlockIngestPrompt({ meetingTitle: cs.meetingTitle, segments: seg(cs.turns) });
    for (let r = 0; r < n; r++) {
      const out = await callTool(c, { model, system, user, schema: BLOCK_INGEST_JSON_SCHEMA, toolName: 'submit_block_ingest', maxTokens: 8000 });
      cost += out.costUsd;
      if (out.error) {
        for (const t of cs.targets) rows.push({ caseId: cs.id, label: t.label, expect: t.expect, matchedSignalType: null, actualBucket: 'NOT_FOUND', ok: false });
        process.stdout.write(`  ✗ ${model} ${cs.id} r${r}: ${out.error}\n`);
        continue;
      }
      if (r === 0) blocksDump[`${model}:${cs.id}`] = ((out.parsed as { blocks?: unknown[] })?.blocks ?? []).map((b) => ({ name: (b as Record<string, unknown>)['name'], signalType: (b as Record<string, unknown>)['signalType'] }));
      for (const t of cs.targets) {
        const sig = findBlockSignal(out.parsed, t.phrase);
        const actual: Bucket | 'NOT_FOUND' = sig ? bucketOf(sig) : 'NOT_FOUND';
        rows.push({ caseId: cs.id, label: t.label, expect: t.expect, matchedSignalType: sig, actualBucket: actual, ok: actual === t.expect });
      }
    }
  }
  return { rows, cost, blocksDump };
}

async function runExtractors(c: OpenAI, model: string, repeats: number, cruxRepeats: number): Promise<{ rows: ExtractResult[]; cost: number }> {
  const rows: ExtractResult[] = [];
  let cost = 0;
  for (const fx of BLOCK_FIXTURES) {
    const isCrux = fx.id.startsWith('B3') || fx.id.startsWith('B5') || fx.id.startsWith('B6');
    const n = isCrux ? Math.max(repeats, cruxRepeats) : repeats;
    for (let r = 0; r < n; r++) {
      // decision-extract
      const decUser = DECISION_EXTRACT_USER_TEMPLATE({
        blockName: fx.blockName,
        criticalQuestion: fx.criticalQuestion,
        trustedAnswer: fx.trustedAnswer,
        signalType: fx.signalType,
        tags: fx.tags,
        evidenceQuotes: fx.evidenceQuotes,
        contextQuotes: fx.contextQuotes,
      });
      const decOut = await callTool(c, { model, system: DECISION_EXTRACT_SYSTEM_PROMPT, user: decUser, schema: DECISION_EXTRACT_JSON_SCHEMA, toolName: 'submit_decision_extract', maxTokens: 1500 });
      cost += decOut.costUsd;
      const dp = decOut.parsed as { isDecision?: boolean; confidence?: number; statement?: string } | null;
      rows.push({ blockId: fx.id, truth: fx.truth, extractor: 'decision', claimed: dp?.isDecision ?? null, confidence: dp?.confidence ?? null, statement: dp?.statement ?? null, error: decOut.error });

      // idea-extract
      const ideaUser = IDEA_EXTRACT_USER_TEMPLATE({
        blockName: fx.blockName,
        criticalQuestion: fx.criticalQuestion,
        trustedAnswer: fx.trustedAnswer,
        signalType: fx.signalType,
        tags: fx.tags,
        evidenceQuotes: fx.evidenceQuotes,
      });
      const ideaOut = await callTool(c, { model, system: IDEA_EXTRACT_SYSTEM_PROMPT, user: ideaUser, schema: IDEA_EXTRACT_JSON_SCHEMA, toolName: 'submit_idea_extract', maxTokens: 1500 });
      cost += ideaOut.costUsd;
      const ip = ideaOut.parsed as { isIdea?: boolean; confidence?: number; statement?: string } | null;
      rows.push({ blockId: fx.id, truth: fx.truth, extractor: 'idea', claimed: ip?.isIdea ?? null, confidence: ip?.confidence ?? null, statement: ip?.statement ?? null, error: ideaOut.error });
    }
  }
  return { rows, cost };
}

// ──────────────────────────── Сводка ────────────────────────────

function summarizeIngest(rows: IngestTargetResult[]): string {
  const byKey = new Map<string, IngestTargetResult[]>();
  for (const r of rows) {
    const k = `${r.caseId}::${r.label}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const lines: string[] = [];
  lines.push('L1 block-ingest — целевые утверждения (ожидание → факт):');
  for (const [k, rs] of byKey) {
    const expect = rs[0]!.expect;
    const dist = new Map<string, number>();
    for (const r of rs) {
      const key = r.actualBucket === 'NOT_FOUND' ? 'NOT_FOUND' : `${r.actualBucket}(${r.matchedSignalType})`;
      dist.set(key, (dist.get(key) ?? 0) + 1);
    }
    const okN = rs.filter((r) => r.ok).length;
    const distStr = [...dist.entries()].map(([key, n]) => `${key}×${n}`).join(', ');
    const flag = okN === rs.length ? '✓' : okN === 0 ? '✗' : '≈';
    lines.push(`  ${flag} [${k}] ожид=${expect} | ${okN}/${rs.length} верно | ${distStr}`);
  }
  return lines.join('\n');
}

function summarizeExtractors(rows: ExtractResult[]): string {
  const byKey = new Map<string, ExtractResult[]>();
  for (const r of rows) {
    const k = `${r.blockId}::${r.extractor}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const lines: string[] = [];
  lines.push('L2 экстракторы — claimed (isDecision/isIdea) по блокам:');
  for (const [k, rs] of byKey) {
    const truth = rs[0]!.truth;
    const trueN = rs.filter((r) => r.claimed === true).length;
    const confs = rs.map((r) => r.confidence).filter((x): x is number => typeof x === 'number');
    const avgConf = confs.length ? (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(2) : 'н/д';
    lines.push(`  [${k}] truth=${truth} | claimed=true ${trueN}/${rs.length} | avgConf=${avgConf}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const models = (str(a, 'models') ?? 'deepseek-v4-pro').split(',').map((s) => s.trim()).filter(Boolean);
  const repeats = num(a, 'repeats') ?? 1;
  const cruxRepeats = num(a, 'crux-repeats') ?? 3;
  const c = client();

  const report: Record<string, unknown> = { ts: new Date().toISOString(), models, repeats, cruxRepeats, perModel: {} };
  let grandCost = 0;

  for (const model of models) {
    process.stdout.write(`\n══════ МОДЕЛЬ ${model} ══════\n`);
    process.stdout.write(`L1 block-ingest (${INGEST_CASES.length} кейсов, crux×${cruxRepeats})…\n`);
    const ing = await runIngest(c, model, repeats, cruxRepeats);
    process.stdout.write(summarizeIngest(ing.rows) + '\n\n');
    process.stdout.write(`L2 экстракторы (${BLOCK_FIXTURES.length} блоков × 2)…\n`);
    const ext = await runExtractors(c, model, repeats, cruxRepeats);
    process.stdout.write(summarizeExtractors(ext.rows) + '\n');
    const modelCost = ing.cost + ext.cost;
    grandCost += modelCost;
    process.stdout.write(`\nстоимость ${model}: $${modelCost.toFixed(4)}\n`);
    (report.perModel as Record<string, unknown>)[model] = { ingest: ing.rows, ingestBlocks: ing.blocksDump, extractors: ext.rows, costUsd: modelCost };
  }

  report.grandCostUsd = grandCost;
  process.stdout.write(`\n════ ИТОГО стоимость: $${grandCost.toFixed(4)} ════\n`);

  const outPath = str(a, 'out');
  if (outPath) {
    await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.writeFile(path.resolve(outPath), JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write(`\n✓ полный отчёт: ${outPath}\n`);
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`\n✗ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
