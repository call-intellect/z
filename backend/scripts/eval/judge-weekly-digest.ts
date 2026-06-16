import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
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
const A_MD_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-a-weekly-digest.md',
);
const B_MD_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-b-weekly-digest.md',
);
const A_JSON = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-a-weekly-digest.json',
);
const B_JSON = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/variant-b-weekly-digest.json',
);
const SUMMARY_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/operations-experiment/reports/SUMMARY-WEEKLY-DIGEST.md',
);

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

const SYSTEM = `Ты — независимый эксперт. Оцениваешь две версии еженедельной сводки для операционного директора (COO) одной команды разработки.

У тебя есть:
1. СЫРЫЕ ДАННЫЕ недели — 25 чек-инов сотрудников, накопленные инсайты, цели спринта, висящие решения, статистика прошлой недели.
2. Две версии markdown-сводки — X и Y. Метки случайны.

Обе версии должны быть полезны COO: показать температуру команды, повторяющиеся блокеры, главные сигналы, статус целей, висящие решения, главный вывод. Длина 250-600 слов. БЕЗ имён сотрудников (приватность).

Оцени КАЖДУЮ версию по 5 критериям шкалой 1-5 (5 = отлично):

1. **accuracy** — точность: соответствует ли тому, что есть в сырых данных? Нет ли галлюцинаций (фактов которых нет), нет ли искажений (доли тональности, число целей, динамика к прошлой неделе)?
2. **depth** — глубина выводов: видит ли версия ПАТТЕРНЫ (например, что новичок прошёл через кризис от понедельника к пятнице; что менторство дало эффект; что Михаил риск выгорания)? Или только пересказывает таблицу?
3. **actionability** — пригодность для решений: есть ли конкретные сигналы, на которые COO может среагировать? Главный вывод действительно выделяет приоритет?
4. **privacy** — приватность: не названы ли сотрудники по именам? Не процитированы ли личные подробности из чек-инов?
5. **clarity** — структура и читаемость: 5-7 разделов, plain markdown, спокойный фактологичный тон, без воды и преамбулы, в пределах 250-600 слов?

Будь СТРОГИМ. 5 — только если выдающаяся работа. Различия объясняй конкретными примерами из текста.

Верни через инструмент submit_judgement.`;

const CRIT = {
  type: 'object',
  required: ['score_x', 'score_y', 'explain'],
  properties: {
    score_x: { type: 'integer', minimum: 1, maximum: 5 },
    score_y: { type: 'integer', minimum: 1, maximum: 5 },
    explain: { type: 'string' },
  },
};

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_judgement',
    description: 'Сравнительная оценка двух версий weekly-digest.',
    parameters: {
      type: 'object',
      required: [
        'accuracy',
        'depth',
        'actionability',
        'privacy',
        'clarity',
        'winner_overall',
        'reasoning',
      ],
      additionalProperties: false,
      properties: {
        accuracy: CRIT,
        depth: CRIT,
        actionability: CRIT,
        privacy: CRIT,
        clarity: CRIT,
        winner_overall: { type: 'string', enum: ['X', 'Y', 'tie'] },
        reasoning: { type: 'string' },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log('=== Судья weekly-digest (DeepSeek-Pro) ===\n');
  const checkinsRaw = JSON.parse(await fs.readFile(CHECKINS_PATH, 'utf-8'));
  const contextRaw = JSON.parse(await fs.readFile(CONTEXT_PATH, 'utf-8'));
  const aMd = await fs.readFile(A_MD_PATH, 'utf-8');
  const bMd = await fs.readFile(B_MD_PATH, 'utf-8');
  const aMeta = JSON.parse(await fs.readFile(A_JSON, 'utf-8'));
  const bMeta = JSON.parse(await fs.readFile(B_JSON, 'utf-8'));

  const swap = Math.random() < 0.5;
  const xLabel: 'A' | 'B' = swap ? 'B' : 'A';
  const yLabel: 'A' | 'B' = swap ? 'A' : 'B';
  const xMd = swap ? bMd : aMd;
  const yMd = swap ? aMd : bMd;
  console.log(`  Маскировка: X = ${xLabel}, Y = ${yLabel}\n`);

  const checkinSummaries = checkinsRaw.checkins
    .map(
      (c: {
        id: string;
        date: string;
        personName: string;
        expectedSentiment: string;
        rawText: string;
      }) =>
        `[${c.id}] ${c.date} ${c.personName} (${c.expectedSentiment}): ${c.rawText.slice(0, 250)}${c.rawText.length > 250 ? '…' : ''}`,
    )
    .join('\n\n');
  const insightsSummary = contextRaw.rawInsights
    .map(
      (i: { id: string; kind: string; weekTrend: string; mentions: number; statement: string }) =>
        `[${i.id}] ${i.kind} / ${i.weekTrend} / mentions=${i.mentions}: ${i.statement}`,
    )
    .join('\n');
  const goalsSummary = contextRaw.rawGoals
    .map(
      (g: { id: string; currentStatus: string; statement: string }) =>
        `[${g.id}] ${g.currentStatus}: ${g.statement}`,
    )
    .join('\n');
  const hangingSummary = contextRaw.rawHangingDecisions
    .map(
      (d: { id: string; ageDays: number; statement: string }) =>
        `[${d.id}] возраст ${d.ageDays} дн.: ${d.statement}`,
    )
    .join('\n');
  const prev = contextRaw.previousWeekStats;

  const userMessage = `# СЫРЫЕ ДАННЫЕ НЕДЕЛИ (для проверки точности и глубины)

## Чек-ины (25)

${checkinSummaries}

## Накопленные инсайты

${insightsSummary}

## Цели спринта

${goalsSummary}

## Висящие решения

${hangingSummary}

## Прошлая неделя

Период ${prev.weekStart} — ${prev.weekEnd}: целей закрыто ${prev.goalsCompleted}, провалено ${prev.goalsFailed}, в работе ${prev.goalsInProgress}; зелёных ${pct(prev.greenShare)}, жёлтых ${pct(prev.yellowShare)}, красных ${pct(prev.redShare)}.

═══════════════════════════════════════

# Версия X

\`\`\`markdown
${xMd}
\`\`\`

# Версия Y

\`\`\`markdown
${yMd}
\`\`\`

Оцени обе версии по 5 критериям. Различия объясняй конкретными примерами. Верни через submit_judgement.`;

  console.log(`  → запрос судье… (вход ≈ ${Math.round(userMessage.length / 4)} токенов)`);
  const start = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  let j: unknown;
  let error: string | undefined;
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 16000,
      tools: [TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{ message?: { tool_calls?: Array<{ function: { arguments: string } }> } }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const call = resp.choices[0]?.message?.tool_calls?.[0];
    if (!call) error = 'судья не позвал tool';
    else j = JSON.parse(call.function.arguments);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cost = tokensIn * PRICE_IN + tokensOut * PRICE_OUT;
  console.log(
    `  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} выход=${tokensOut} | $${cost.toFixed(4)}${error ? ` | ${error}` : ''}\n`,
  );
  if (error || !j) {
    process.exit(1);
  }

  const jj = j as {
    accuracy: { score_x: number; score_y: number; explain: string };
    depth: { score_x: number; score_y: number; explain: string };
    actionability: { score_x: number; score_y: number; explain: string };
    privacy: { score_x: number; score_y: number; explain: string };
    clarity: { score_x: number; score_y: number; explain: string };
    winner_overall: 'X' | 'Y' | 'tie';
    reasoning: string;
  };

  const scoreFor = (label: 'A' | 'B', crit: { score_x: number; score_y: number }): number =>
    label === xLabel ? crit.score_x : crit.score_y;
  const explainNorm = (text: string): string =>
    text
      .replace(/\bверсия X\b/gi, `версия ${xLabel}`)
      .replace(/\bверсия Y\b/gi, `версия ${yLabel}`)
      .replace(/(?<![A-Za-zА-Яа-я])X(?![A-Za-zА-Яа-я])/g, xLabel)
      .replace(/(?<![A-Za-zА-Яа-я])Y(?![A-Za-zА-Яа-я])/g, yLabel);
  const winnerReal: 'A' | 'B' | 'tie' =
    jj.winner_overall === 'tie' ? 'tie' : jj.winner_overall === 'X' ? xLabel : yLabel;
  const sumOf = (label: 'A' | 'B'): number =>
    scoreFor(label, jj.accuracy) +
    scoreFor(label, jj.depth) +
    scoreFor(label, jj.actionability) +
    scoreFor(label, jj.privacy) +
    scoreFor(label, jj.clarity);

  const md = `# Сравнение weekly-digest: A (код-агрегат → LLM) vs Б (LLM делает всё)

Дата: ${new Date().toISOString()}
Модель A / Б: deepseek-v4-pro · Судья: ${MODEL}
Фикстура: неделя 2026-05-19 — 2026-05-23 (25 чек-инов команды)

## Цифровые метрики

| Метрика | A (код-агрегат) | Б (LLM-агрегация) |
|---|---|---|
| Время | ${(aMeta.totalMs / 1000).toFixed(1)} с | ${(bMeta.totalMs / 1000).toFixed(1)} с |
| Стоимость | $${aMeta.totalCostUsd.toFixed(4)} | $${bMeta.totalCostUsd.toFixed(4)} |
| Вход (токены) | ${aMeta.totalTokensIn} | ${bMeta.totalTokensIn} |
| Выход (токены) | ${aMeta.totalTokensOut} | ${bMeta.totalTokensOut} |
| Markdown (слов) | ${aMeta.markdownWords} | ${bMeta.markdownWords} |

Экономика: A в ${(bMeta.totalCostUsd / aMeta.totalCostUsd).toFixed(2)}× дешевле Б.

## Вердикт судьи (метки X/Y скрыты)

**Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}**

> ${explainNorm(jj.reasoning)}

### По критериям (5 = отлично, 1 = плохо)

| Критерий | A | Б | Объяснение |
|---|---|---|---|
| accuracy (точность) | ${scoreFor('A', jj.accuracy)} | ${scoreFor('B', jj.accuracy)} | ${explainNorm(jj.accuracy.explain)} |
| depth (глубина) | ${scoreFor('A', jj.depth)} | ${scoreFor('B', jj.depth)} | ${explainNorm(jj.depth.explain)} |
| actionability (применимость) | ${scoreFor('A', jj.actionability)} | ${scoreFor('B', jj.actionability)} | ${explainNorm(jj.actionability.explain)} |
| privacy (приватность) | ${scoreFor('A', jj.privacy)} | ${scoreFor('B', jj.privacy)} | ${explainNorm(jj.privacy.explain)} |
| clarity (структура) | ${scoreFor('A', jj.clarity)} | ${scoreFor('B', jj.clarity)} | ${explainNorm(jj.clarity.explain)} |

### Сумма
- Variant A: ${sumOf('A')} / 25
- Variant Б: ${sumOf('B')} / 25

## Метаданные
- Маскировка: X = ${xLabel}, Y = ${yLabel}.
- Судья: ${MODEL}, вход=${tokensIn} токенов, выход=${tokensOut} токенов, стоимость $${cost.toFixed(4)}, время ${(ms / 1000).toFixed(1)} с.
`;

  await fs.writeFile(SUMMARY_PATH, md, 'utf-8');
  console.log('=== Итог ===');
  console.log(`  Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}`);
  console.log(`  A = ${sumOf('A')} / Б = ${sumOf('B')} (из 25)`);
  console.log(`\n✓ отчёт: ${SUMMARY_PATH}`);
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
