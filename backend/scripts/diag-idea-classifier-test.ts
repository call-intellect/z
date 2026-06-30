import {
  IDEA_EXTRACT_SYSTEM_PROMPT,
  IDEA_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/idea-extract.prompt';
import {
  renderExamplesForIdeaExtractor,
  TASK_VS_DECISION_PAIRS,
} from '../src/modules/knowledge-core/prompts/task-decision-examples';

type FixtureClass = 'idea' | 'task';

type Fixture = {
  id: string;
  statement: string;
  quote: string;
  cls: FixtureClass;
  note: string;
};

const STRENGTHENED = IDEA_EXTRACT_SYSTEM_PROMPT;

const TASK_RULE_BLOCK = renderExamplesForIdeaExtractor();

const OLD = STRENGTHENED.split('\n')
  .filter((line) => !TASK_RULE_BLOCK.split('\n').includes(line))
  .filter((line) => !line.startsWith('7. Это НЕ поручение/задача'))
  .join('\n');

const NEGATIVE: Fixture[] = [
  { id: 'N1', statement: 'Отправить счёт Сергею', quote: 'Отправить счёт Сергею', cls: 'task', note: 'реальная задача из кабинета' },
  { id: 'N2', statement: 'Составить план лидогенерации декора', quote: 'Составить план лидогенерации декора', cls: 'task', note: 'реальная задача из кабинета' },
  ...TASK_VS_DECISION_PAIRS.slice(0, 6).map((p, i) => ({
    id: `N${i + 3}`,
    statement: p.task,
    quote: p.task,
    cls: 'task' as const,
    note: `синтетика (${p.domain}) — задача-в-идеях`,
  })),
];

const POSITIVE: Fixture[] = [
  { id: 'P1', statement: 'Добавить экспорт отчёта о встрече в формат PDF', quote: 'Добавить экспорт отчёта о встрече в формат PDF', cls: 'idea', note: 'настоящая идея' },
  { id: 'P2', statement: 'Кэшировать эмбеддинги одинаковых блоков для экономии токенов', quote: 'Кэшировать эмбеддинги одинаковых блоков для экономии токенов', cls: 'idea', note: 'настоящая идея' },
  { id: 'P3', statement: 'Добавить тёмную тему интерфейса', quote: 'Добавить тёмную тему интерфейса', cls: 'idea', note: 'настоящая идея' },
  { id: 'P4', statement: 'Сделать массовый импорт контактов из CSV', quote: 'Сделать массовый импорт контактов из CSV', cls: 'idea', note: 'настоящая идея' },
  { id: 'P5', statement: 'Добавить уведомления о незакрытых задачах в Telegram', quote: 'Добавить уведомления о незакрытых задачах в Telegram', cls: 'idea', note: 'настоящая идея' },
];

const ALL_FIXTURES: Fixture[] = [...NEGATIVE, ...POSITIVE];

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

type RunOutcome = { ok: boolean | null; isIdea: boolean | null; detail: string; error?: string };

function userFor(f: Fixture): string {
  return IDEA_EXTRACT_USER_TEMPLATE({
    blockName: f.statement,
    criticalQuestion: 'Какую идею/предложение зафиксировали?',
    trustedAnswer: f.statement,
    signalType: 'idea',
    tags: [],
    evidenceQuotes: [f.quote],
  });
}

function expectIsIdea(f: Fixture): boolean {
  return f.cls === 'idea';
}

async function runIdeaExtract(prompt: string, f: Fixture): Promise<RunOutcome> {
  try {
    const parsed = await callJson(prompt, userFor(f));
    const isIdea = typeof parsed?.isIdea === 'boolean' ? (parsed.isIdea as boolean) : null;
    if (isIdea === null) return { ok: null, isIdea: null, detail: 'isIdea=?' };
    const expect = expectIsIdea(f);
    return { ok: isIdea === expect, isIdea, detail: `isIdea=${isIdea}` };
  } catch (e) {
    return { ok: null, isIdea: null, detail: 'ERROR', error: e instanceof Error ? e.message : String(e) };
  }
}

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

async function runPrompt(label: string, prompt: string): Promise<Map<string, RunOutcome>> {
  console.log(`\n===== ПРОГОН: ${label} =====`);
  const results = new Map<string, RunOutcome>();
  for (let i = 0; i < ALL_FIXTURES.length; i += BATCH) {
    const chunk = ALL_FIXTURES.slice(i, i + BATCH);
    const outcomes = await Promise.all(chunk.map((f) => runIdeaExtract(prompt, f)));
    chunk.forEach((f, j) => {
      const o = outcomes[j] ?? { ok: null, isIdea: null, detail: 'ERR' };
      results.set(f.id, o);
      console.log(
        `${f.id.padEnd(5)} ожид=${(expectIsIdea(f) ? 'idea' : 'task').padEnd(5)} | ${o.detail.padEnd(14)} ${mark(o.ok)} | «${f.quote.slice(0, 56)}»${o.error ? ` [${o.error}]` : ''}`,
      );
    });
    if (i + BATCH < ALL_FIXTURES.length) await sleep(PAUSE_MS);
  }
  return results;
}

function summarize(title: string, results: Map<string, RunOutcome>, group: Fixture[]): Tally {
  const t = emptyTally();
  for (const f of group) {
    const o = results.get(f.id);
    tallyAdd(t, o ? o.ok : null);
  }
  console.log(`  ${title}: OK ${t.pass}/${group.length} (fail ${t.fail}, err ${t.unknown})`);
  return t;
}

function rejectedTasks(results: Map<string, RunOutcome>): number {
  let n = 0;
  for (const f of NEGATIVE) {
    const o = results.get(f.id);
    if (o?.isIdea === false) n++;
  }
  return n;
}

function regressIdeas(results: Map<string, RunOutcome>): number {
  let n = 0;
  for (const f of POSITIVE) {
    const o = results.get(f.id);
    if (o?.isIdea === false) n++;
  }
  return n;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('Нет DEEPSEEK_API_KEY. Запусти: bun run --env-file=../.env scripts/diag-idea-classifier-test.ts');
    process.exit(1);
  }

  console.log(`Модель: ${MODEL} · endpoint: ${ENDPOINT}`);
  console.log(`Фикстур всего: ${ALL_FIXTURES.length} (задач-в-идеях=${NEGATIVE.length}, идей=${POSITIVE.length})`);
  console.log(`Длина промптов: OLD=${OLD.length} симв., STRENGTHENED=${STRENGTHENED.length} симв. (дельта ${STRENGTHENED.length - OLD.length})`);
  console.log(`Ориентировочно LLM-вызовов: ${ALL_FIXTURES.length * 2} (${ALL_FIXTURES.length} фикстур × 2 промпта)`);

  const oldResults = await runPrompt('OLD (без правила «задача≠идея»)', OLD);
  const strResults = await runPrompt('STRENGTHENED (с правилом «задача≠идея» из Ф3)', STRENGTHENED);

  console.log('\n=== СВОДКА ===');
  console.log('OLD:');
  summarize('задачи-в-идеях (→ false)', oldResults, NEGATIVE);
  summarize('настоящие идеи (→ true)', oldResults, POSITIVE);
  console.log('STRENGTHENED:');
  summarize('задачи-в-идеях (→ false)', strResults, NEGATIVE);
  summarize('настоящие идеи (→ true)', strResults, POSITIVE);

  const N = NEGATIVE.length;
  const M = POSITIVE.length;
  const oldRej = rejectedTasks(oldResults);
  const oldReg = regressIdeas(oldResults);
  const strRej = rejectedTasks(strResults);
  const strReg = regressIdeas(strResults);
  const oldPct = pct(oldRej, N);
  const strPct = pct(strRej, N);

  console.log('\n=== ИТОГ (задача≠идея) ===');
  console.log(`OLD:          отсев задач ${oldRej}/${N} (${oldPct}%) · регресс по идеям ${oldReg}/${M}`);
  console.log(`STRENGTHENED: отсев задач ${strRej}/${N} (${strPct}%) · регресс по идеям ${strReg}/${M}`);
  console.log(`Acceptance: усиленный отсекает ≥80% задач-в-идеях (${strPct}% ≥ 80) и регресс по идеям = 0 (${strReg}=0)`);

  const pass = strPct >= 80 && strReg === 0;
  console.log(`\nВЕРДИКТ: ${pass ? 'PASS' : 'FAIL'} (отсев ${strPct}% ≥ 80 && регресс ${strReg} === 0)`);
}

void main();
