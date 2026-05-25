/**
 * Variant Б+ — один объединённый вызов на ВСЕ 8 типов сущностей.
 *
 * Отличие от Б: добавлены knowledge-clone categories, skill-traits, helpfulness.
 * Гипотеза: одна большая модель за один thinking-проход извлечёт глубоко
 * все 8 типов, как у Г, но дешевле (один вызов вместо 8).
 */
import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'deepseek-v4-pro';
const PRICE_IN = 0.435 / 1_000_000;
const PRICE_CACHED_IN = 0.003625 / 1_000_000;
const PRICE_OUT = 0.87 / 1_000_000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]):/, '$1:');
const FIXTURE_PATH = path.resolve(SCRIPT_DIR, '../../test/eval/specialists-experiment/fixtures/meeting-blocks.json');
const REPORT_PATH = path.resolve(SCRIPT_DIR, '../../test/eval/specialists-experiment/reports/variant-b-plus.json');

if (!process.env.DEEPSEEK_API_KEY) { console.error('✗ DEEPSEEK_API_KEY не задан'); process.exit(1); }
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

interface Block { id: string; name: string; criticalQuestion: string; trustedAnswer: string; signalType: string; tags: string[]; evidence: { quote: string; speaker: string }; mentionedPersons: string[]; }

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_all_8_entities',
    description: 'Извлечь все 8 типов сущностей из блоков встречи.',
    parameters: {
      type: 'object',
      required: ['decisions', 'ideas', 'insights', 'experiments', 'regulations', 'knowledge_categories', 'skill_traits', 'helpfulness_traits'],
      additionalProperties: false,
      properties: {
        decisions: { type: 'array', items: { type: 'object', required: ['sourceBlockId', 'statement', 'confidence'], properties: { sourceBlockId: { type: 'string' }, statement: { type: 'string' }, rationale: { type: ['string', 'null'] }, alternatives: { type: 'array', items: { type: 'string' } }, decidedBy: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['proposed', 'approved', 'rejected', 'implemented'] }, confidence: { type: 'number' } } } },
        ideas: { type: 'array', items: { type: 'object', required: ['sourceBlockId', 'kind', 'statement', 'confidence'], properties: { sourceBlockId: { type: 'string' }, kind: { type: 'string', enum: ['internal', 'client_request'] }, statement: { type: 'string' }, rationale: { type: ['string', 'null'] }, confidence: { type: 'number' } } } },
        insights: { type: 'array', items: { type: 'object', required: ['sourceBlockId', 'kind', 'statement', 'severity', 'causeCategory', 'confidence'], properties: { sourceBlockId: { type: 'string' }, kind: { type: 'string', enum: ['problem', 'risk', 'blocker', 'inefficiency'] }, statement: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, causeCategory: { type: 'string', enum: ['process_gap', 'tooling', 'role_skill', 'communication', 'priority', 'resource_constraint', 'external', 'unknown'] }, mitigationSuggestion: { type: ['string', 'null'] }, confidence: { type: 'number' } } } },
        experiments: { type: 'array', items: { type: 'object', required: ['sourceBlockId', 'name', 'hypothesisText', 'status', 'confidence'], properties: { sourceBlockId: { type: 'string' }, name: { type: 'string' }, hypothesisText: { type: 'string' }, currentResult: { type: ['string', 'null'] }, lessons: { type: 'array', items: { type: 'object', required: ['text', 'type'], properties: { text: { type: 'string' }, type: { type: 'string', enum: ['what_worked', 'what_failed', 'next_time'] } } } }, status: { type: 'string', enum: ['hypothesis', 'running', 'completed', 'dropped', 'paused'] }, confidence: { type: 'number' } } } },
        regulations: { type: 'array', items: { type: 'object', required: ['sourceBlockId', 'kind', 'name', 'statement', 'confidence'], properties: { sourceBlockId: { type: 'string' }, kind: { type: 'string', enum: ['regulation', 'process', 'policy', 'standard'] }, name: { type: 'string' }, statement: { type: 'string' }, severity: { type: 'string', enum: ['advisory', 'mandatory', 'blocking'] }, confidence: { type: 'number' } } } },
        knowledge_categories: { type: 'array', items: { type: 'object', required: ['personName', 'category', 'confidence'], properties: { personName: { type: 'string' }, category: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, sampleStatements: { type: 'array', items: { type: 'string' } }, sourceBlockIds: { type: 'array', items: { type: 'string' } } } } },
        skill_traits: { type: 'array', items: { type: 'object', required: ['personName', 'category', 'statement', 'confidence'], properties: { personName: { type: 'string' }, category: { type: 'string' }, statement: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, sourceBlockIds: { type: 'array', items: { type: 'string' } } } } },
        helpfulness_traits: { type: 'array', items: { type: 'object', required: ['sourceBlockId', 'traitType', 'helperUserHint', 'topicHint', 'intensity', 'confidence'], properties: { sourceBlockId: { type: 'string' }, traitType: { type: 'string', enum: ['help_provided', 'proactive_hint', 'mentoring', 'emotional_support', 'constructive_feedback'] }, helperUserHint: { type: 'string' }, recipientUserHint: { type: ['string', 'null'] }, topicHint: { type: 'string' }, intensity: { type: 'number' }, evidenceQuote: { type: 'string' }, confidence: { type: 'number' } } } },
      },
    },
  },
};

const SYS = `Ты — knowledge-инженер. Получаешь все блоки одной встречи. Извлекаешь ВОСЕМЬ типов сущностей за один проход через submit_all_8_entities.

Маршрутизация по signalType:
- decision/rationale → decisions[] (объединяй decision + соседний rationale в одну запись)
- idea/feature_request → ideas[] (kind=internal или client_request)
- pain/risk/blocker → insights[] (с severity, causeCategory, mitigationSuggestion)
- hypothesis/result/lesson → experiments[] (объединяй блоки одного эксперимента)
- regulation/process_step → regulations[]
- expertise/experience/competence/reasoning (по человеку) → knowledge_categories[] (per person: 1-3 эмерджентные категории знаний)
- reasoning/methodology_step (≥3 на одного человека) → skill_traits[] (гипотезные черты подхода к решениям)
- help_provided/proactive_hint/mentoring/emotional_support → helpfulness_traits[]
- fact и прочие → пропускай

Жёсткие требования к глубине:
- decisions: ОБЯЗАТЕЛЬНО rationale (ищи в соседних блоках), alternatives (если упоминались).
- insights: ОБЯЗАТЕЛЬНО mitigationSuggestion (или null если действительно нет).
- experiments: lessons[] должны быть многослойные (что сработало / не сработало / next_time).
- knowledge_categories: эмерджентные имена, не enum.
- skill_traits: формулировки ГИПОТЕЗНЫЕ ("Похоже, склонен..."), не приговорные.

Не выдумывай факты вне блоков. sourceBlockId обязательно. Все строки на русском.`;

function blocksToContext(blocks: Block[]): string {
  return blocks.map((b) => `[BLOCK:${b.id}] (signalType=${b.signalType}, persons=${b.mentionedPersons.join(',') || '-'})\n  ${b.name}\n  В: ${b.criticalQuestion}\n  О: ${b.trustedAnswer}\n  Цитата (${b.evidence.speaker}): «${b.evidence.quote}»`).join('\n\n');
}

async function main() {
  console.log('=== Variant Б+ — один вызов на все 8 типов сущностей ===');
  const fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, 'utf-8'));
  console.log(`  блоков: ${fixture.blocks.length}\n  → запрос…`);
  const start = Date.now();
  const resp = (await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: `Все блоки встречи «${fixture.meetingTitle}» (${fixture.blocks.length} шт):\n\n${blocksToContext(fixture.blocks)}\n\nВажно: верни через submit_all_8_entities.` },
    ],
    max_tokens: 32000,
    tools: [TOOL],
    tool_choice: 'auto',
  } as Parameters<typeof client.chat.completions.create>[0])) as any;
  const ms = Date.now() - start;
  const u = resp.usage ?? {};
  const tokensIn = u.prompt_tokens ?? 0;
  const tokensOut = u.completion_tokens ?? 0;
  const cached = u.prompt_cache_hit_tokens ?? u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, tokensIn - cached);
  const cost = uncached * PRICE_IN + cached * PRICE_CACHED_IN + tokensOut * PRICE_OUT;
  const call = resp.choices?.[0]?.message?.tool_calls?.[0];
  let output: any = null;
  let error: string | undefined;
  if (!call) { error = 'модель не позвала tool'; output = resp.choices?.[0]?.message?.content ?? ''; }
  else { try { output = JSON.parse(call.function.arguments); } catch (e) { error = `JSON.parse: ${(e as Error).message}`; output = { rawArgs: call.function.arguments }; } }
  const counts = output && typeof output === 'object' && !error ? {
    decisions: (output.decisions ?? []).length,
    ideas: (output.ideas ?? []).length,
    insights: (output.insights ?? []).length,
    experiments: (output.experiments ?? []).length,
    regulations: (output.regulations ?? []).length,
    knowledge_categories: (output.knowledge_categories ?? []).length,
    skill_traits: (output.skill_traits ?? []).length,
    helpfulness_traits: (output.helpfulness_traits ?? []).length,
  } : {};
  const total = Object.values(counts).reduce((a: number, b) => a + (b as number), 0);
  console.log(`\n  ${error ? '✗' : '✓'} ${ms} мс | вход=${tokensIn} (кэш=${cached}) выход=${tokensOut} | $${cost.toFixed(4)}`);
  console.log('  Извлечено:');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v}`);
  console.log(`  ВСЕГО сущностей: ${total}`);
  if (error) console.log(`  Ошибка: ${error}`);
  await fs.writeFile(REPORT_PATH, JSON.stringify({ variant: 'B+', fixtureId: fixture.fixtureId, model: MODEL, totalMs: ms, totalTokensIn: tokensIn, totalTokensOut: tokensOut, totalCachedTokens: cached, totalCostUsd: cost, totalEntities: total, counts, output, error }, null, 2), 'utf-8');
  console.log(`\n✓ ${REPORT_PATH}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
