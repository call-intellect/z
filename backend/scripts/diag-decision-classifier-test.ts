import {
  DECISION_EXTRACT_SYSTEM_PROMPT,
  DECISION_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/decision-extract.prompt';
import {
  TASK_EXTRACT_SYSTEM_PROMPT,
  TASK_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/task-extract.prompt';
import { buildBlockIngestPrompt } from '../src/modules/knowledge-core/prompts/block-ingest.prompt';
import { TASK_VS_DECISION_PAIRS } from '../src/modules/knowledge-core/prompts/task-decision-examples';

type FixtureClass = 'decision' | 'task' | 'idea';

type Fixture = {
  id: string;
  statement: string;
  quote: string;
  cls: FixtureClass;
  note: string;
  expectIngestIncludes?: string[];
  expectIngestExcludes?: string[];
};

const NEGATIVE_DECISION_EXTRACT: Fixture[] = [
  { id: 'N1', statement: 'Айназ подтвердила задачу изучить скрипт', quote: 'задача айнас изучить скрипт подходит', cls: 'task', note: 'постановка задачи + согласие исполнителя' },
  { id: 'N2', statement: 'chydo_002 взял на себя задачу изучить обновление сервиса', quote: 'задача мне изучить обновление сервиса', cls: 'task', note: 'взятие задачи на себя' },
  { id: 'N3', statement: 'Сергею поручено настроить отправку ссылки на подключение в Telegram', quote: 'задача сергею сделать так чтобы в Telegram всегда приходила ссылка на подключение', cls: 'task', note: 'поручение' },
  { id: 'N4', statement: 'Айназ взяла на себя обязательство проверить все поставленные задачи', quote: 'мне тогда задача проверить все задачи те задачи', cls: 'task', note: 'взятие задачи' },
  { id: 'N5', statement: 'Поручить участнику chydo_002 выяснить, почему ссылка на видео-встречу не доставлена в Telegram', quote: 'задачу ставлю на тебя а ты сейчас отправила ссылку на видео встречу но в Telegram ссылка не пришла задача выяснить почему не пришла да', cls: 'task', note: 'поручение «ставлю задачу»' },
];

const POSITIVE_DECISION_EXTRACT: Fixture[] = [
  { id: 'P1', statement: 'Отключаем Telegram как канал коммуникации', quote: 'Telegram отключаем', cls: 'decision', note: 'реальное решение-выбор (отказ от канала)' },
  { id: 'P2', statement: 'Создать отдельную группу по продукту, чтобы информация не смешивалась с другими', quote: 'создать отдельно группу именно по этому продукту, чтобы вся информация только здесь была', cls: 'decision', note: 'реальное решение об организации коммуникации' },
  { id: 'P3', statement: 'Уходим к поставщику SMS Aero вместо Twilio', quote: 'смотрели Twilio и SMS Aero, Twilio дорогой в России, идём с SMS Aero, договор на квартал', cls: 'decision', note: 'явный выбор поставщика с обоснованием' },
  { id: 'P4', statement: 'Клиент подключает стандартный тариф без ОКК минимум на полгода', quote: 'берём стандартный тариф без ОКК минимум на полгода', cls: 'decision', note: 'выбор тарифа' },
  { id: 'P5', statement: 'Начать тестирование продукта с одной задачи (пилотный подход), затем масштабировать', quote: 'начинаем с пилота на одной задаче, потом масштабируем', cls: 'decision', note: 'выбор подхода к внедрению' },
];

const SYNTHETIC_PAIRS_USED = 10;

function buildSyntheticFixtures(): Fixture[] {
  const out: Fixture[] = [];
  TASK_VS_DECISION_PAIRS.slice(0, SYNTHETIC_PAIRS_USED).forEach((p, i) => {
    out.push({
      id: `SD${i + 1}`,
      statement: p.decision,
      quote: p.decision,
      cls: 'decision',
      note: `синтетика (${p.domain}) — решение`,
    });
    out.push({
      id: `ST${i + 1}`,
      statement: p.task,
      quote: p.task,
      cls: 'task',
      note: `синтетика (${p.domain}) — задача`,
    });
  });
  return out;
}

const SYNTHETIC: Fixture[] = buildSyntheticFixtures();

const MIXED_THREE_CLASS: Fixture[] = [
  {
    id: 'M1',
    statement: 'Анна предлагает backoff, Михаил берёт реализацию',
    quote: 'предлагаю реализовать exponential backoff для Битрикс API; окей, беру реализацию на себя',
    cls: 'idea',
    note: 'предложение + поручение — ожидаем idea И commitment/action_item, без decision',
    expectIngestIncludes: ['idea', 'commitment', 'action_item'],
    expectIngestExcludes: ['decision'],
  },
  {
    id: 'M2',
    statement: 'Елена пока не заводит задачу по жалобе на плеер',
    quote: 'отдельную задачу по жалобе на плеер пока не завожу',
    cls: 'idea',
    note: 'бытовое не-действие — не decision и не action_item; decision-extract → isDecision=false',
    expectIngestExcludes: ['decision', 'action_item'],
  },
];

const ALL_FIXTURES: Fixture[] = [
  ...NEGATIVE_DECISION_EXTRACT,
  ...POSITIVE_DECISION_EXTRACT,
  ...SYNTHETIC,
  ...MIXED_THREE_CLASS,
];

const API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-chat';
const ENDPOINT = /\/chat\/completions$/.test(BASE_URL) ? BASE_URL : `${BASE_URL}/chat/completions`;

async function callJson(system: string, user: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type RunOutcome = { ok: boolean | null; detail: string; error?: string };

function decisionExpectIsDecision(f: Fixture): boolean {
  return f.cls === 'decision';
}

function taskExpectIsTask(f: Fixture): boolean {
  return f.cls === 'task';
}

function decisionExtractUser(f: Fixture): string {
  return DECISION_EXTRACT_USER_TEMPLATE({
    blockName: f.statement,
    criticalQuestion: 'Какое решение принято на встрече?',
    trustedAnswer: f.statement,
    signalType: 'decision',
    tags: [],
    evidenceQuotes: [f.quote],
    contextQuotes: [],
  });
}

function taskExtractUser(f: Fixture): string {
  return TASK_EXTRACT_USER_TEMPLATE({
    blockName: f.statement,
    criticalQuestion: 'Какая задача поставлена?',
    trustedAnswer: f.statement,
    signalType: 'action_item',
    tags: [],
    evidenceQuotes: [f.quote],
  });
}

function blockIngestUser(f: Fixture): { system: string; user: string } {
  return buildBlockIngestPrompt({
    segments: [{ startMs: 0, endMs: 5000, speakers: ['Speaker_0'], text: f.quote }],
  });
}

async function runDecisionExtract(f: Fixture): Promise<RunOutcome> {
  try {
    const parsed = await callJson(DECISION_EXTRACT_SYSTEM_PROMPT, decisionExtractUser(f));
    const isDecision = typeof parsed?.isDecision === 'boolean' ? (parsed.isDecision as boolean) : null;
    if (isDecision === null) return { ok: null, detail: 'isDecision=?' };
    const expect = decisionExpectIsDecision(f);
    return { ok: isDecision === expect, detail: `isDecision=${isDecision}` };
  } catch (e) {
    return { ok: null, detail: 'ERROR', error: e instanceof Error ? e.message : String(e) };
  }
}

async function runTaskExtract(f: Fixture): Promise<RunOutcome> {
  try {
    const parsed = await callJson(TASK_EXTRACT_SYSTEM_PROMPT, taskExtractUser(f));
    const isTask = typeof parsed?.isTask === 'boolean' ? (parsed.isTask as boolean) : null;
    if (isTask === null) return { ok: null, detail: 'isTask=?' };
    const expect = taskExpectIsTask(f);
    return { ok: isTask === expect, detail: `isTask=${isTask}` };
  } catch (e) {
    return { ok: null, detail: 'ERROR', error: e instanceof Error ? e.message : String(e) };
  }
}

function collectSignalTypes(parsed: Record<string, unknown> | null): string[] {
  const blocks = parsed?.blocks;
  if (!Array.isArray(blocks)) return [];
  const types: string[] = [];
  for (const b of blocks) {
    const st = (b as Record<string, unknown>)?.signalType;
    if (typeof st === 'string') types.push(st);
  }
  return types;
}

const ACTION_LIKE = new Set(['action_item', 'commitment']);

function checkExplicitIngest(f: Fixture, set: Set<string>): boolean {
  const includes = f.expectIngestIncludes ?? [];
  const excludes = f.expectIngestExcludes ?? [];
  const actionExpected = includes.filter((t) => ACTION_LIKE.has(t));
  const plainExpected = includes.filter((t) => !ACTION_LIKE.has(t));
  const plainOk = plainExpected.every((t) => set.has(t));
  const actionOk = actionExpected.length === 0 || actionExpected.some((t) => set.has(t));
  const excludesOk = excludes.every((t) => !set.has(t));
  return plainOk && actionOk && excludesOk;
}

async function runBlockIngest(f: Fixture): Promise<RunOutcome> {
  try {
    const { system, user } = blockIngestUser(f);
    const parsed = await callJson(system, user);
    const types = collectSignalTypes(parsed);
    if (types.length === 0) return { ok: null, detail: 'нет blocks' };
    const set = new Set(types);
    const detail = `signalType=[${types.join(',')}]`;
    if (f.expectIngestIncludes || f.expectIngestExcludes) {
      return { ok: checkExplicitIngest(f, set), detail };
    }
    const hasDecision = set.has('decision');
    const hasAction = [...set].some((t) => ACTION_LIKE.has(t));
    if (f.cls === 'decision') {
      return { ok: hasDecision && !hasAction, detail };
    }
    return { ok: hasAction && !hasDecision, detail };
  } catch (e) {
    return { ok: null, detail: 'ERROR', error: e instanceof Error ? e.message : String(e) };
  }
}

type RunFn = (f: Fixture) => Promise<RunOutcome>;

type Tally = { pass: number; fail: number; unknown: number };

function emptyTally(): Tally {
  return { pass: 0, fail: 0, unknown: 0 };
}

function tallyAdd(t: Tally, ok: boolean | null): void {
  if (ok === true) t.pass++;
  else if (ok === false) t.fail++;
  else t.unknown++;
}

function mark(ok: boolean | null): string {
  if (ok === true) return 'OK  ';
  if (ok === false) return 'FAIL';
  return 'ERR ';
}

const BATCH = 4;
const PAUSE_MS = 400;

async function runAgent(
  label: string,
  fn: RunFn,
  fixtures: Fixture[],
  expectLabel: (f: Fixture) => string,
): Promise<Map<string, RunOutcome>> {
  console.log(`\n===== ПРОГОН: ${label} =====`);
  const results = new Map<string, RunOutcome>();
  for (let i = 0; i < fixtures.length; i += BATCH) {
    const chunk = fixtures.slice(i, i + BATCH);
    const outcomes = await Promise.all(chunk.map((f) => fn(f)));
    chunk.forEach((f, j) => {
      const o = outcomes[j];
      results.set(f.id, o);
      console.log(
        `${f.id.padEnd(5)} ожид=${expectLabel(f).padEnd(10)} | ${o.detail.padEnd(28)} ${mark(o.ok)} | «${f.quote.slice(0, 56)}»${o.error ? ` [${o.error}]` : ''}`,
      );
    });
    if (i + BATCH < fixtures.length) await sleep(PAUSE_MS);
  }
  return results;
}

function summarize(
  title: string,
  results: Map<string, RunOutcome>,
  group: Fixture[],
): Tally {
  const t = emptyTally();
  for (const f of group) {
    const o = results.get(f.id);
    tallyAdd(t, o ? o.ok : null);
  }
  console.log(`  ${title}: OK ${t.pass}/${group.length} (fail ${t.fail}, err ${t.unknown})`);
  return t;
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('Нет DEEPSEEK_API_KEY. Запусти: bun run --env-file=<путь к .env> scripts/diag-decision-classifier-test.ts');
    process.exit(1);
  }

  const decisionFixtures = ALL_FIXTURES.filter((f) => f.cls === 'decision');
  const taskFixtures = ALL_FIXTURES.filter((f) => f.cls === 'task');
  const ideaFixtures = ALL_FIXTURES.filter((f) => f.cls === 'idea');

  console.log(`Модель: ${MODEL} · endpoint: ${ENDPOINT}`);
  console.log(`Фикстур всего: ${ALL_FIXTURES.length} (решений=${decisionFixtures.length}, задач=${taskFixtures.length}, идей=${ideaFixtures.length})`);
  console.log(`  decision-extract: NEGATIVE=${NEGATIVE_DECISION_EXTRACT.length}, POSITIVE=${POSITIVE_DECISION_EXTRACT.length}, синтетика=${SYNTHETIC.length}`);
  console.log(`  трёхклассовые (idea+поручение / бытовое не-действие): ${MIXED_THREE_CLASS.length}`);
  for (const f of MIXED_THREE_CLASS) {
    console.log(`    ${f.id} [${f.cls}] inc=[${(f.expectIngestIncludes ?? []).join(',')}] exc=[${(f.expectIngestExcludes ?? []).join(',')}] — ${f.note}`);
  }
  console.log(`Ориентировочно LLM-вызовов: ${ALL_FIXTURES.length * 3} (${ALL_FIXTURES.length} фикстур × 3 агента)`);

  const decisionResults = await runAgent(
    'decision-extract (ожидаем isDecision: решение→true, задача→false)',
    runDecisionExtract,
    ALL_FIXTURES,
    (f) => (f.cls === 'decision' ? 'true' : 'false'),
  );

  const taskResults = await runAgent(
    'task-extract (ожидаем isTask: задача→true, решение→false)',
    runTaskExtract,
    ALL_FIXTURES,
    (f) => (f.cls === 'task' ? 'true' : 'false'),
  );

  const ingestResults = await runAgent(
    'block-ingest (решение→signalType decision; задача→action_item/commitment, без decision)',
    runBlockIngest,
    ALL_FIXTURES,
    (f) => (f.cls === 'decision' ? 'decision' : 'action'),
  );

  console.log('\n=== СВОДКА ===');

  console.log('decision-extract:');
  summarize('NEGATIVE (псевдо-решения → false)', decisionResults, NEGATIVE_DECISION_EXTRACT);
  summarize('POSITIVE (настоящие решения → true)', decisionResults, POSITIVE_DECISION_EXTRACT);
  summarize('синтетика-решения (→ true)', decisionResults, SYNTHETIC.filter((f) => f.cls === 'decision'));
  summarize('синтетика-задачи (→ false)', decisionResults, SYNTHETIC.filter((f) => f.cls === 'task'));

  console.log('task-extract:');
  const taskTasks = summarize('задачи (→ true)', taskResults, ALL_FIXTURES.filter((f) => f.cls === 'task'));
  const taskDecisions = summarize('решения (→ false)', taskResults, ALL_FIXTURES.filter((f) => f.cls === 'decision'));

  console.log('block-ingest:');
  const ingestDecisions = summarize('решения (→ decision)', ingestResults, ALL_FIXTURES.filter((f) => f.cls === 'decision'));
  const ingestTasks = summarize('задачи (→ action_item/commitment)', ingestResults, ALL_FIXTURES.filter((f) => f.cls === 'task'));
  const ingestMixed = summarize('трёхклассовые (idea+поручение / бытовое не-действие)', ingestResults, MIXED_THREE_CLASS);
  summarize('decision-extract по трёхклассовым (→ false)', decisionResults, MIXED_THREE_CLASS);

  console.log('\n=== ИТОГ ===');
  const negJunk = summarize('decision-extract: отсев мусора (псевдо-решения → false)', decisionResults, NEGATIVE_DECISION_EXTRACT);
  const posReal = summarize('decision-extract: регресс по настоящим (решения → true)', decisionResults, POSITIVE_DECISION_EXTRACT);
  console.log(
    `Мусор отсечён: ${negJunk.pass}/${NEGATIVE_DECISION_EXTRACT.length} · регресс по настоящим решениям: ${POSITIVE_DECISION_EXTRACT.length - posReal.pass}/${POSITIVE_DECISION_EXTRACT.length} (цель 0).`,
  );
  console.log(
    `Симметрия task-extract: задачи→true ${taskTasks.pass}/${taskTasks.pass + taskTasks.fail + taskTasks.unknown}, решения→false ${taskDecisions.pass}/${taskDecisions.pass + taskDecisions.fail + taskDecisions.unknown}.`,
  );
  console.log(
    `Классификация block-ingest: решения→decision ${ingestDecisions.pass}/${ingestDecisions.pass + ingestDecisions.fail + ingestDecisions.unknown}, задачи→action ${ingestTasks.pass}/${ingestTasks.pass + ingestTasks.fail + ingestTasks.unknown}.`,
  );
  console.log(
    `Трёхклассовые (idea отдельно от поручения, бытовое не-действие без decision/action): ${ingestMixed.pass}/${MIXED_THREE_CLASS.length}.`,
  );
}

void main();
