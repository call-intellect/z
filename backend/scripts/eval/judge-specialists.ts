import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const REPORTS_DIR = path.resolve(SCRIPT_DIR, '../../test/eval/specialists-experiment/reports');
const FIXTURE_PATH = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/specialists-experiment/fixtures/meeting-blocks.json',
);
const A_PATH = path.join(REPORTS_DIR, 'variant-a.json');
const B_PATH = path.join(REPORTS_DIR, 'variant-b.json');
const C_PATH = path.join(REPORTS_DIR, 'variant-c.json');
const SUMMARY_PATH = path.join(REPORTS_DIR, 'SUMMARY.md');

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('✗ DEEPSEEK_API_KEY не задан');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface NormalizedEntities {
  decisions: unknown[];
  ideas: unknown[];
  insights: unknown[];
  experiments: unknown[];
  regulations: unknown[];
}

function normalize(report: {
  steps: Array<{ step: string; output?: unknown }>;
  variant: string;
}): NormalizedEntities {
  const out: NormalizedEntities = {
    decisions: [],
    ideas: [],
    insights: [],
    experiments: [],
    regulations: [],
  };
  for (const step of report.steps) {
    const o = step.output as Record<string, unknown> | undefined;
    if (!o) continue;
    for (const key of ['decisions', 'ideas', 'insights', 'experiments', 'regulations'] as const) {
      const arr = o[key];
      if (Array.isArray(arr)) out[key].push(...arr);
    }
  }
  return out;
}

const JUDGE_SYSTEM = `Ты — независимый эксперт по системам извлечения структурированного знания. Тебе дают:
1. Фикстуру: 55 IdeaBlock-ов одной командной планёрки разработки.
2. Три варианта извлечения типизированных сущностей (decisions, ideas, insights, experiments, regulations) — X, Y, Z.

Маски X/Y/Z случайны.

Оцени каждый вариант по 4 критериям шкалой 1-5 (5 = отлично):

1. **coverage** — полнота: извлёк ли вариант ВСЕ ожидаемые сущности из блоков своих типов? Считай: блоков типа decision+rationale — 5, ideas+feature_request — 6, pain+risk+blocker — 5, hypothesis+result+lesson — 7, regulation+process_step — 7. Сущностей должно быть примерно столько же.
2. **accuracy** — точность: правильно ли типизированы? Решения как decisions, идеи как ideas (не наоборот). Нет ли галлюцинаций (фактов вне блоков).
3. **structure** — качество структуры: заполнены ли поля (rationale, severity, causeCategory, status), правильные ли enum-значения, sourceBlockId соответствует блоку.
4. **detail** — глубина извлечения: rationale содержательный или null? lessons[] раскрыты? alternatives[] заполнены? Хорошее извлечение даёт много полей, поверхностное — только обязательные.

Будь строгим: 5 — только если выдающаяся работа.

Верни результат через инструмент submit_judgement.`;

const CRIT_OBJ = {
  type: 'object',
  required: ['score_x', 'score_y', 'score_z', 'explain'],
  properties: {
    score_x: { type: 'integer', minimum: 1, maximum: 5 },
    score_y: { type: 'integer', minimum: 1, maximum: 5 },
    score_z: { type: 'integer', minimum: 1, maximum: 5 },
    explain: { type: 'string' },
  },
};

const JUDGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_judgement',
    description: 'Сравнительная оценка трёх вариантов извлечения.',
    parameters: {
      type: 'object',
      required: ['coverage', 'accuracy', 'structure', 'detail', 'winner_overall', 'reasoning'],
      additionalProperties: false,
      properties: {
        coverage: CRIT_OBJ,
        accuracy: CRIT_OBJ,
        structure: CRIT_OBJ,
        detail: CRIT_OBJ,
        winner_overall: { type: 'string', enum: ['X', 'Y', 'Z', 'tie'] },
        reasoning: { type: 'string' },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log('=== Судья specialists (DeepSeek-Pro) ===\n');

  const fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  const aReport = JSON.parse(await fs.readFile(A_PATH, 'utf-8'));
  const bReport = JSON.parse(await fs.readFile(B_PATH, 'utf-8'));
  const cReport = JSON.parse(await fs.readFile(C_PATH, 'utf-8'));

  const aNorm = normalize(aReport);
  const bNorm = normalize(bReport);
  const cNorm = normalize(cReport);

  const labels: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [labels[i], labels[j]] = [labels[j]!, labels[i]!];
  }
  const xLabel = labels[0]!;
  const yLabel = labels[1]!;
  const zLabel = labels[2]!;
  const labelToNorm: Record<'A' | 'B' | 'C', NormalizedEntities> = {
    A: aNorm,
    B: bNorm,
    C: cNorm,
  };
  const xOutput = labelToNorm[xLabel];
  const yOutput = labelToNorm[yLabel];
  const zOutput = labelToNorm[zLabel];
  console.log(`  Маскировка: X=${xLabel}, Y=${yLabel}, Z=${zLabel}\n`);

  const userMessage = `# Фикстура (краткая сводка)

Встреча: ${fixture.meetingTitle}
Сценарий: ${fixture.scenario}
Блоков всего: ${fixture.blocks.length}

Распределение по signalType (для понимания ожиданий):
${countSignals(fixture.blocks)}

# Полные блоки фикстуры (для проверки точности)

\`\`\`json
${JSON.stringify(fixture.blocks.slice(0, 20), null, 2)}
... (показаны первые 20 из ${fixture.blocks.length})
\`\`\`

# Вариант X
Сущностей: ${countAll(xOutput)}
\`\`\`json
${JSON.stringify(xOutput, null, 2)}
\`\`\`

# Вариант Y
Сущностей: ${countAll(yOutput)}
\`\`\`json
${JSON.stringify(yOutput, null, 2)}
\`\`\`

# Вариант Z
Сущностей: ${countAll(zOutput)}
\`\`\`json
${JSON.stringify(zOutput, null, 2)}
\`\`\`

Оцени по 4 критериям. Верни через submit_judgement.`;

  console.log(`  → запрос судье… (вход ≈ ${Math.round(userMessage.length / 4)} токенов)`);
  const start = Date.now();
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  let judgement: unknown;
  let error: string | undefined;
  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 32000,
      tools: [JUDGE_TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { arguments: string } }>;
        };
      }>;
      usage?: typeof usage;
    };
    usage = resp.usage ?? {};
    const call = resp.choices[0]?.message?.tool_calls?.[0];
    if (!call) {
      error = 'судья не позвал tool';
    } else {
      judgement = JSON.parse(call.function.arguments);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - start;
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const costUsd = tokensIn * PRICE_IN + tokensOut * PRICE_OUT;
  console.log(
    `  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} выход=${tokensOut} | $${costUsd.toFixed(4)}${error ? ` | ${error}` : ''}\n`,
  );
  if (error) {
    console.error('Судья не отработал.');
    process.exit(1);
  }

  const j = judgement as {
    coverage: { score_x: number; score_y: number; score_z: number; explain: string };
    accuracy: { score_x: number; score_y: number; score_z: number; explain: string };
    structure: { score_x: number; score_y: number; score_z: number; explain: string };
    detail: { score_x: number; score_y: number; score_z: number; explain: string };
    winner_overall: 'X' | 'Y' | 'Z' | 'tie';
    reasoning: string;
  };

  const scoreFor = (
    label: 'A' | 'B' | 'C',
    crit: { score_x: number; score_y: number; score_z: number },
  ): number => {
    if (label === xLabel) return crit.score_x;
    if (label === yLabel) return crit.score_y;
    return crit.score_z;
  };
  const explainNormalized = (text: string): string =>
    text
      .replace(/\bвариант X\b/gi, `вариант ${xLabel}`)
      .replace(/\bвариант Y\b/gi, `вариант ${yLabel}`)
      .replace(/\bвариант Z\b/gi, `вариант ${zLabel}`)
      .replace(/\bX\b/g, xLabel)
      .replace(/\bY\b/g, yLabel)
      .replace(/\bZ\b/g, zLabel);
  const winnerReal =
    j.winner_overall === 'tie'
      ? 'tie'
      : j.winner_overall === 'X'
        ? xLabel
        : j.winner_overall === 'Y'
          ? yLabel
          : zLabel;

  const sumOf = (label: 'A' | 'B' | 'C'): number =>
    scoreFor(label, j.coverage) +
    scoreFor(label, j.accuracy) +
    scoreFor(label, j.structure) +
    scoreFor(label, j.detail);

  const md = `# Сравнение специалистов: A vs Б vs В

Дата: ${new Date().toISOString()}
Модель Variant A/Б/В: deepseek-v4-pro · Судья: ${MODEL}
Фикстура: ${fixture.meetingTitle} (${fixture.blocks.length} блоков)

## Цифровые метрики

| Метрика | A (5 раздельных) | Б (1 объединённый) | В (2 группы) |
|---|---|---|---|
| Вызовов | ${aReport.steps.length} | ${bReport.steps.length} | ${cReport.steps.length} |
| Время | ${(aReport.totalMs / 1000).toFixed(1)} с | ${(bReport.totalMs / 1000).toFixed(1)} с | ${(cReport.totalMs / 1000).toFixed(1)} с |
| Стоимость | $${aReport.totalCostUsd.toFixed(4)} | $${bReport.totalCostUsd.toFixed(4)} | $${cReport.totalCostUsd.toFixed(4)} |
| Сущностей всего | ${countAll(aNorm)} | ${countAll(bNorm)} | ${countAll(cNorm)} |

### По типам сущностей

| Тип | A | Б | В |
|---|---|---|---|
| decisions | ${aNorm.decisions.length} | ${bNorm.decisions.length} | ${cNorm.decisions.length} |
| ideas | ${aNorm.ideas.length} | ${bNorm.ideas.length} | ${cNorm.ideas.length} |
| insights | ${aNorm.insights.length} | ${bNorm.insights.length} | ${cNorm.insights.length} |
| experiments | ${aNorm.experiments.length} | ${bNorm.experiments.length} | ${cNorm.experiments.length} |
| regulations | ${aNorm.regulations.length} | ${bNorm.regulations.length} | ${cNorm.regulations.length} |

## Вердикт судьи (метки X/Y/Z скрыты)

**Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}**

> ${explainNormalized(j.reasoning)}

### По критериям (5 = отлично, 1 = плохо)

| Критерий | A | Б | В | Объяснение |
|---|---|---|---|---|
| coverage (полнота) | ${scoreFor('A', j.coverage)} | ${scoreFor('B', j.coverage)} | ${scoreFor('C', j.coverage)} | ${explainNormalized(j.coverage.explain)} |
| accuracy (точность) | ${scoreFor('A', j.accuracy)} | ${scoreFor('B', j.accuracy)} | ${scoreFor('C', j.accuracy)} | ${explainNormalized(j.accuracy.explain)} |
| structure (схема) | ${scoreFor('A', j.structure)} | ${scoreFor('B', j.structure)} | ${scoreFor('C', j.structure)} | ${explainNormalized(j.structure.explain)} |
| detail (глубина) | ${scoreFor('A', j.detail)} | ${scoreFor('B', j.detail)} | ${scoreFor('C', j.detail)} | ${explainNormalized(j.detail.explain)} |

### Сумма баллов
- Variant A: ${sumOf('A')} / 20
- Variant Б: ${sumOf('B')} / 20
- Variant В: ${sumOf('C')} / 20

## Метаданные

- Маскировка: X = вариант ${xLabel}, Y = вариант ${yLabel}, Z = вариант ${zLabel}.
- Судья: ${MODEL}, вход=${tokensIn} токенов, выход=${tokensOut} токенов, стоимость $${costUsd.toFixed(4)}, время ${(ms / 1000).toFixed(1)} с.
`;

  await fs.writeFile(SUMMARY_PATH, md, 'utf-8');
  console.log(`=== Итог ===`);
  console.log(`  Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${winnerReal}`}`);
  console.log(`  A=${sumOf('A')} / Б=${sumOf('B')} / В=${sumOf('C')} (из 20)`);
  console.log(`\n✓ отчёт: ${SUMMARY_PATH}`);
}

function countSignals(blocks: Array<{ signalType: string }>): string {
  const counts: Record<string, number> = {};
  for (const b of blocks) counts[b.signalType] = (counts[b.signalType] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

function countAll(norm: NormalizedEntities): number {
  return (
    norm.decisions.length +
    norm.ideas.length +
    norm.insights.length +
    norm.experiments.length +
    norm.regulations.length
  );
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
