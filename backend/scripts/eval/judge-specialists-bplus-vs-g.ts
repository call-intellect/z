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
const G_PATH = path.join(REPORTS_DIR, 'variant-g.json');
const BPLUS_PATH = path.join(REPORTS_DIR, 'variant-b-plus.json');
const SUMMARY_PATH = path.join(REPORTS_DIR, 'SUMMARY-BPLUS-VS-G.md');

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
  knowledge_categories: unknown[];
  skill_traits: unknown[];
  helpfulness_traits: unknown[];
}

function emptyNorm(): NormalizedEntities {
  return {
    decisions: [],
    ideas: [],
    insights: [],
    experiments: [],
    regulations: [],
    knowledge_categories: [],
    skill_traits: [],
    helpfulness_traits: [],
  };
}

function normalizeG(report: {
  steps: Array<{ step: string; output?: Record<string, unknown> }>;
}): NormalizedEntities {
  const out = emptyNorm();
  const map: Array<[string, string, keyof NormalizedEntities]> = [
    ['3-3 decisions', 'decisions', 'decisions'],
    ['3-6 ideas', 'ideas', 'ideas'],
    ['3-5 insights', 'insights', 'insights'],
    ['3-9 experiments', 'experiments', 'experiments'],
    ['3-1 regulations', 'regulations', 'regulations'],
    ['3-2 knowledge-clone', 'categories', 'knowledge_categories'],
    ['3-7 skill-traits', 'traits', 'skill_traits'],
    ['3-8 helpfulness', 'traits', 'helpfulness_traits'],
  ];
  for (const [stepName, outKey, targetKey] of map) {
    const step = report.steps.find((s) => s.step === stepName);
    const arr = step?.output?.[outKey];
    if (Array.isArray(arr)) out[targetKey] = arr;
  }
  return out;
}

function normalizeBPlus(report: { output?: Record<string, unknown> }): NormalizedEntities {
  const out = emptyNorm();
  const o = report.output ?? {};
  for (const key of Object.keys(out) as Array<keyof NormalizedEntities>) {
    const arr = o[key];
    if (Array.isArray(arr)) out[key] = arr;
  }
  return out;
}

function countAll(norm: NormalizedEntities): number {
  return (
    norm.decisions.length +
    norm.ideas.length +
    norm.insights.length +
    norm.experiments.length +
    norm.regulations.length +
    norm.knowledge_categories.length +
    norm.skill_traits.length +
    norm.helpfulness_traits.length
  );
}

const JUDGE_SYSTEM = `Ты — независимый эксперт по системам извлечения структурированного знания из встреч.

Тебе дают:
1. Фикстуру: 55 IdeaBlock-ов одной командной планёрки разработки.
2. Два варианта извлечения сущностей восьми типов — X и Y.

Маски X/Y случайны.

Восемь типов сущностей и какие блоки в них ожидаются:
- decisions — решения. Источник: блоки signalType ∈ {decision, rationale}. Ожидается ~4-5.
- ideas — идеи и feature-запросы. Источник: {idea, feature_request}. Ожидается ~5-6.
- insights — проблемы/риски/блокеры. Источник: {pain, risk, blocker}. Ожидается ~4-5.
- experiments — эксперименты (гипотеза → результат → урок). Источник: {hypothesis, result, lesson}, ОБЪЕДИНЯЮТСЯ в одну запись. Ожидается ~3-4.
- regulations — регламенты/процессы. Источник: {regulation, process_step}. Ожидается ~6-7.
- knowledge_categories — категории знаний по персонам. Источник: {expertise, experience, competence, reasoning} (по 1-3 на персону). Ожидается ~6-10.
- skill_traits — черты подхода человека (гипотезы). Источник: {reasoning, methodology_step} (только если хватает наблюдений). Ожидается ~2-5.
- helpfulness_traits — паттерны помощи (один блок может породить несколько). Источник: {help_provided, proactive_hint, mentoring, emotional_support}. Ожидается ~3-5.

Оцени КАЖДЫЙ вариант по 4 критериям шкалой 1-5 (5 = отлично):

1. **coverage** — полнота: извлёк ли вариант ВСЕ ожидаемые сущности по 8 типам? Считай по верхним границам выше.
2. **accuracy** — точность: правильно ли типизированы (решение как decision, идея как idea, не наоборот)? Нет ли галлюцинаций (фактов вне блоков)? Правильно ли объединены родственные блоки в experiments?
3. **structure** — качество структуры полей: заполнены ли rationale, severity, causeCategory, status, mitigationSuggestion, lessons[]; правильные ли enum-значения; sourceBlockId совпадает с реальными id блоков (вид blk_NNN).
4. **detail** — глубина извлечения: rationale содержательный (а не «потому что обсудили»)? alternatives[] заполнены? lessons[] раскрыты? У knowledge_categories sampleStatements не пустые? У helpfulness evidenceQuote — реальная цитата?

Будь СТРОГИМ: 5 — только если выдающаяся работа. 3 — норма. Различия между X и Y нужно ОБЪЯСНЯТЬ конкретными примерами из их данных.

Верни результат через инструмент submit_judgement.`;

const CRIT_OBJ = {
  type: 'object',
  required: ['score_x', 'score_y', 'explain'],
  properties: {
    score_x: { type: 'integer', minimum: 1, maximum: 5 },
    score_y: { type: 'integer', minimum: 1, maximum: 5 },
    explain: { type: 'string' },
  },
};

const JUDGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_judgement',
    description: 'Сравнительная оценка двух вариантов извлечения по 8 типам сущностей.',
    parameters: {
      type: 'object',
      required: ['coverage', 'accuracy', 'structure', 'detail', 'winner_overall', 'reasoning'],
      additionalProperties: false,
      properties: {
        coverage: CRIT_OBJ,
        accuracy: CRIT_OBJ,
        structure: CRIT_OBJ,
        detail: CRIT_OBJ,
        winner_overall: { type: 'string', enum: ['X', 'Y', 'tie'] },
        reasoning: { type: 'string' },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log('=== Судья Б+ vs Г (DeepSeek-Pro) ===\n');

  const fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  const gReport = JSON.parse(await fs.readFile(G_PATH, 'utf-8'));
  const bPlusReport = JSON.parse(await fs.readFile(BPLUS_PATH, 'utf-8'));

  const gNorm = normalizeG(gReport);
  const bPlusNorm = normalizeBPlus(bPlusReport);

  console.log('  Г: сущностей по типам:', JSON.stringify(countByType(gNorm)));
  console.log('  Б+: сущностей по типам:', JSON.stringify(countByType(bPlusNorm)));

  const swap = Math.random() < 0.5;
  const xLabel: 'BPLUS' | 'G' = swap ? 'G' : 'BPLUS';
  const yLabel: 'BPLUS' | 'G' = swap ? 'BPLUS' : 'G';
  const xOutput = swap ? gNorm : bPlusNorm;
  const yOutput = swap ? bPlusNorm : gNorm;
  console.log(`\n  Маскировка: X = ${xLabel}, Y = ${yLabel}\n`);

  const userMessage = `# Фикстура (краткая сводка)

Встреча: ${fixture.meetingTitle}
Сценарий: ${fixture.scenario ?? '(не указан)'}
Блоков всего: ${fixture.blocks.length}

Распределение по signalType (для понимания ожиданий):
${countSignals(fixture.blocks)}

# Полные блоки фикстуры (для проверки точности)

\`\`\`json
${JSON.stringify(fixture.blocks, null, 2)}
\`\`\`

# Вариант X
Сущностей всего: ${countAll(xOutput)}
По типам: ${JSON.stringify(countByType(xOutput))}

\`\`\`json
${JSON.stringify(xOutput, null, 2)}
\`\`\`

# Вариант Y
Сущностей всего: ${countAll(yOutput)}
По типам: ${JSON.stringify(countByType(yOutput))}

\`\`\`json
${JSON.stringify(yOutput, null, 2)}
\`\`\`

Оцени X и Y по 4 критериям. Различия объясняй конкретными примерами. Верни через submit_judgement.`;

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
    coverage: { score_x: number; score_y: number; explain: string };
    accuracy: { score_x: number; score_y: number; explain: string };
    structure: { score_x: number; score_y: number; explain: string };
    detail: { score_x: number; score_y: number; explain: string };
    winner_overall: 'X' | 'Y' | 'tie';
    reasoning: string;
  };

  const scoreFor = (label: 'BPLUS' | 'G', crit: { score_x: number; score_y: number }): number =>
    label === xLabel ? crit.score_x : crit.score_y;

  const explainNormalized = (text: string): string =>
    text
      .replace(/\bвариант X\b/gi, `вариант ${labelToName(xLabel)}`)
      .replace(/\bвариант Y\b/gi, `вариант ${labelToName(yLabel)}`)
      .replace(/(?<![A-Za-zА-Яа-я])X(?![A-Za-zА-Яа-я])/g, labelToName(xLabel))
      .replace(/(?<![A-Za-zА-Яа-я])Y(?![A-Za-zА-Яа-я])/g, labelToName(yLabel));

  const winnerReal: 'BPLUS' | 'G' | 'tie' =
    j.winner_overall === 'tie' ? 'tie' : j.winner_overall === 'X' ? xLabel : yLabel;

  const sumOf = (label: 'BPLUS' | 'G'): number =>
    scoreFor(label, j.coverage) +
    scoreFor(label, j.accuracy) +
    scoreFor(label, j.structure) +
    scoreFor(label, j.detail);

  const md = `# Сравнение специалистов: Б+ (один вызов на 8 типов) vs Г (8 раздельных с кэшем)

Дата: ${new Date().toISOString()}
Модель Б+ / Г: deepseek-v4-pro · Судья: ${MODEL}
Фикстура: ${fixture.meetingTitle} (${fixture.blocks.length} блоков)

## Цифровые метрики

| Метрика | Б+ (1 вызов / 8 типов) | Г (8 раздельных / кэш) |
|---|---|---|
| Вызовов | 1 | ${gReport.steps.length} |
| Время | ${(bPlusReport.totalMs / 1000).toFixed(1)} с | ${(gReport.totalMs / 1000).toFixed(1)} с |
| Стоимость | $${bPlusReport.totalCostUsd.toFixed(4)} | $${gReport.totalCostUsd.toFixed(4)} |
| Кэш-хит средн. | — | ${gReport.avgCacheHitRatio ? (gReport.avgCacheHitRatio * 100).toFixed(0) + '%' : '—'} |
| Сущностей всего | ${countAll(bPlusNorm)} | ${countAll(gNorm)} |

Экономика: Б+ в ${(gReport.totalCostUsd / bPlusReport.totalCostUsd).toFixed(2)}× дешевле Г.

### По типам сущностей

| Тип | Б+ | Г |
|---|---|---|
| decisions | ${bPlusNorm.decisions.length} | ${gNorm.decisions.length} |
| ideas | ${bPlusNorm.ideas.length} | ${gNorm.ideas.length} |
| insights | ${bPlusNorm.insights.length} | ${gNorm.insights.length} |
| experiments | ${bPlusNorm.experiments.length} | ${gNorm.experiments.length} |
| regulations | ${bPlusNorm.regulations.length} | ${gNorm.regulations.length} |
| knowledge_categories | ${bPlusNorm.knowledge_categories.length} | ${gNorm.knowledge_categories.length} |
| skill_traits | ${bPlusNorm.skill_traits.length} | ${gNorm.skill_traits.length} |
| helpfulness_traits | ${bPlusNorm.helpfulness_traits.length} | ${gNorm.helpfulness_traits.length} |

## Вердикт судьи (метки X/Y скрыты)

**Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${labelToName(winnerReal)}`}**

> ${explainNormalized(j.reasoning)}

### По критериям (5 = отлично, 1 = плохо)

| Критерий | Б+ | Г | Объяснение |
|---|---|---|---|
| coverage (полнота) | ${scoreFor('BPLUS', j.coverage)} | ${scoreFor('G', j.coverage)} | ${explainNormalized(j.coverage.explain)} |
| accuracy (точность) | ${scoreFor('BPLUS', j.accuracy)} | ${scoreFor('G', j.accuracy)} | ${explainNormalized(j.accuracy.explain)} |
| structure (схема) | ${scoreFor('BPLUS', j.structure)} | ${scoreFor('G', j.structure)} | ${explainNormalized(j.structure.explain)} |
| detail (глубина) | ${scoreFor('BPLUS', j.detail)} | ${scoreFor('G', j.detail)} | ${explainNormalized(j.detail.explain)} |

### Сумма баллов
- Variant Б+: ${sumOf('BPLUS')} / 20
- Variant Г:  ${sumOf('G')} / 20

## Метаданные

- Маскировка: X = вариант ${labelToName(xLabel)}, Y = вариант ${labelToName(yLabel)}.
- Судья: ${MODEL}, вход=${tokensIn} токенов, выход=${tokensOut} токенов, стоимость $${costUsd.toFixed(4)}, время ${(ms / 1000).toFixed(1)} с.
`;

  await fs.writeFile(SUMMARY_PATH, md, 'utf-8');
  console.log(`=== Итог ===`);
  console.log(
    `  Победитель: ${winnerReal === 'tie' ? 'ничья' : `Variant ${labelToName(winnerReal)}`}`,
  );
  console.log(`  Б+ = ${sumOf('BPLUS')} / Г = ${sumOf('G')} (из 20)`);
  console.log(`\n✓ отчёт: ${SUMMARY_PATH}`);
}

function labelToName(label: 'BPLUS' | 'G' | 'tie'): string {
  if (label === 'BPLUS') return 'Б+';
  if (label === 'G') return 'Г';
  return 'tie';
}

function countSignals(blocks: Array<{ signalType: string }>): string {
  const counts: Record<string, number> = {};
  for (const b of blocks) counts[b.signalType] = (counts[b.signalType] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

function countByType(norm: NormalizedEntities): Record<keyof NormalizedEntities, number> {
  return {
    decisions: norm.decisions.length,
    ideas: norm.ideas.length,
    insights: norm.insights.length,
    experiments: norm.experiments.length,
    regulations: norm.regulations.length,
    knowledge_categories: norm.knowledge_categories.length,
    skill_traits: norm.skill_traits.length,
    helpfulness_traits: norm.helpfulness_traits.length,
  };
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
