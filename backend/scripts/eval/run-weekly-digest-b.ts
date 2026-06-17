import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const CHECKINS_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/fixtures/checkins-week.json',
);
const CONTEXT_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/fixtures/week-context.json',
);
const REPORT_JSON = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-b-weekly-digest.json',
);
const REPORT_MD = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-b-weekly-digest.md',
);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

const SYSTEM_PROMPT = [
  'Ты — аналитик операционного директора. У тебя СЫРЫЕ данные недели команды разработки:',
  '  - все вечерние чек-ины сотрудников (текст + автор + дата + тональность от классификатора);',
  '  - накопленные инсайты (с динамикой);',
  '  - цели спринта (статусы);',
  '  - висящие решения (старше 7 дней без статуса);',
  '  - статистика прошлой недели (для дельт).',
  '',
  'Твоя задача — БЕЗ дополнительной кодовой агрегации построить связный комментарий из 5-7 коротких разделов в формате Markdown:',
  '',
  '  1. Температура команды (доли зелёных/жёлтых/красных, динамика к прошлой неделе, тревожные моменты).',
  '  2. Главные блокеры (повторяющиеся, что мешает регулярно — выяви из чек-инов).',
  '  3. Сигналы недели (топ-инсайты — что обостряется, что появилось нового).',
  '  4. Цели (что закрыли, что провалили, что в работе; динамика к прошлой неделе).',
  '  5. Висящие решения (что зависло без отметки о результате).',
  '  6. Главный вывод (1-2 предложения — на что обратить внимание в первую очередь).',
  '',
  'Жёсткие правила:',
  '  - На русском, plain markdown без HTML и без таблиц.',
  '  - Сначала САМ агрегируй сырые данные (посчитай доли тональности, найди повторяющиеся темы в текстах чек-инов).',
  '  - НЕ называй сотрудников по именам и НЕ цитируй персональные подробности из чек-инов (приватность). Используй обобщения вроде «один из инженеров», «новичок в команде», «один сотрудник».',
  '  - Только то, что есть в данных. Не додумывай и не давай советов на пустом месте.',
  '  - Без воды и без преамбулы. Сразу к делу.',
  '  - Тон — спокойный и фактологичный (не алармизм, не оптимизм).',
  '  - Если по какому-то блоку данных нет — пропусти раздел.',
  '  - Длина — 250-600 слов.',
].join('\n');

interface CheckIn {
  id: string;
  personName: string;
  date: string;
  kind: string;
  rawText: string;
  expectedSentiment: 'green' | 'yellow' | 'red';
}

interface Insight {
  id: string;
  kind: string;
  statement: string;
  severity: string;
  firstSeenAt: string;
  mentions: number;
  weekTrend: string;
}

interface Goal {
  id: string;
  statement: string;
  owner: string;
  plannedFor: string | null;
  currentStatus: string;
  completedAt: string | null;
  notes: string;
}

interface HangingDecision {
  id: string;
  statement: string;
  discussedAt: string;
  ageDays: number;
  notes: string;
}

interface PreviousStats {
  weekStart: string;
  weekEnd: string;
  goalsCompleted: number;
  goalsFailed: number;
  goalsInProgress: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
}

function buildUserMessage(args: {
  weekStart: string;
  weekEnd: string;
  checkins: CheckIn[];
  insights: Insight[];
  goals: Goal[];
  hangingDecisions: HangingDecision[];
  previousWeek: PreviousStats;
}): string {
  const lines: string[] = [];
  lines.push(`Период: ${args.weekStart} — ${args.weekEnd}.`);
  lines.push('');
  lines.push('═══ Сырые вечерние чек-ины сотрудников ═══');
  lines.push('');
  for (const c of args.checkins) {
    lines.push(`[${c.id}] ${c.date} — ${c.personName} (тональность: ${c.expectedSentiment})`);
    lines.push(c.rawText);
    lines.push('');
  }
  lines.push('═══ Накопленные инсайты команды ═══');
  lines.push('');
  for (const i of args.insights) {
    lines.push(
      `[${i.id}] kind=${i.kind}, severity=${i.severity}, trend=${i.weekTrend}, mentions=${i.mentions} (первое упоминание ${i.firstSeenAt})`,
    );
    lines.push(`  ${i.statement}`);
    lines.push('');
  }
  lines.push('═══ Цели спринта ═══');
  lines.push('');
  for (const g of args.goals) {
    lines.push(
      `[${g.id}] status=${g.currentStatus}, owner=${g.owner}${g.plannedFor ? `, planned ${g.plannedFor}` : ''}`,
    );
    lines.push(`  ${g.statement}`);
    if (g.notes) lines.push(`  заметка: ${g.notes}`);
    lines.push('');
  }
  lines.push('═══ Висящие решения (старше 7 дней без статуса) ═══');
  lines.push('');
  for (const d of args.hangingDecisions) {
    lines.push(`[${d.id}] возраст ${d.ageDays} дн., обсуждалось ${d.discussedAt}`);
    lines.push(`  ${d.statement}`);
    if (d.notes) lines.push(`  заметка: ${d.notes}`);
    lines.push('');
  }
  lines.push('═══ Прошлая неделя (для дельт) ═══');
  lines.push('');
  lines.push(
    `Период ${args.previousWeek.weekStart} — ${args.previousWeek.weekEnd}: ` +
      `закрыто целей ${args.previousWeek.goalsCompleted}, провалено ${args.previousWeek.goalsFailed}, в работе ${args.previousWeek.goalsInProgress}; ` +
      `зелёных ${pct(args.previousWeek.greenShare)}, жёлтых ${pct(args.previousWeek.yellowShare)}, красных ${pct(args.previousWeek.redShare)}.`,
  );
  lines.push('');
  lines.push('═══ Задача ═══');
  lines.push(
    'Построй markdown-комментарий по правилам из system-промпта. Сначала сам агрегируй сырые данные.',
  );
  return lines.join('\n');
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

async function main(): Promise<void> {
  console.log('=== Variant Б — weekly-digest: LLM делает агрегацию + markdown ===');
  const checkinsRaw = JSON.parse(await fs.readFile(CHECKINS_PATH, 'utf-8'));
  const contextRaw = JSON.parse(await fs.readFile(CONTEXT_PATH, 'utf-8'));

  const userMessage = buildUserMessage({
    weekStart: checkinsRaw.weekStart,
    weekEnd: checkinsRaw.weekEnd,
    checkins: checkinsRaw.checkins,
    insights: contextRaw.rawInsights,
    goals: contextRaw.rawGoals,
    hangingDecisions: contextRaw.rawHangingDecisions,
    previousWeek: contextRaw.previousWeekStats,
  });

  console.log(
    `  чек-инов: ${checkinsRaw.checkins.length}, инсайтов: ${contextRaw.rawInsights.length}, целей: ${contextRaw.rawGoals.length}`,
  );
  console.log(
    `  вход (user-msg): ${userMessage.length} знаков (≈${Math.round(userMessage.length / 4)} токенов)`,
  );
  console.log('  → запрос…');

  const start = Date.now();
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  let markdown = '';
  let error: string | undefined;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    markdown = resp.choices[0]?.message?.content ?? '';
    if (!markdown) error = 'модель вернула пустой content';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cached =
    usage.prompt_cache_hit_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  const uncached = Math.max(0, tokensIn - cached);
  const cost = uncached * PRICE_IN + cached * PRICE_CACHED_IN + tokensOut * PRICE_OUT;

  console.log(
    `\n  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cached}) выход=${tokensOut} | $${cost.toFixed(4)}${error ? ` | ${error}` : ''}`,
  );
  console.log(`  markdown: ${markdown.length} знаков, ${countWords(markdown)} слов`);

  await fs.writeFile(REPORT_MD, markdown, 'utf-8');
  await fs.writeFile(
    REPORT_JSON,
    JSON.stringify(
      {
        variant: 'B',
        hypothesis: 'weekly-digest: LLM делает агрегацию + markdown',
        fixtureId: checkinsRaw.fixtureId,
        model: MODEL,
        totalMs: ms,
        totalTokensIn: tokensIn,
        totalTokensOut: tokensOut,
        totalCachedTokens: cached,
        totalCostUsd: cost,
        markdownChars: markdown.length,
        markdownWords: countWords(markdown),
        markdown,
        userMessageChars: userMessage.length,
        error,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n✓ markdown: ${REPORT_MD}`);
  console.log(`✓ метрики: ${REPORT_JSON}`);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
