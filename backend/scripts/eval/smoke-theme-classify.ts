import {
  client,
  computeCost,
  logRun,
  MODEL,
  readFixture,
  shortResponse,
  type SmokeReport,
  type Usage,
  writeReport,
} from './_smoke-shared';

const TASK_TYPE = 'theme-classify';

const SYSTEM_PROMPT = `Ты — аналитик, который называет тематические кластеры IdeaBlock'ов компании.

На вход — N блоков (criticalQuestion + trustedAnswer + signalType + tags) и список упомянутых сущностей.

Твоя задача — дать кластеру:
1. "name" — короткое имя темы (≤100 символов, существительное / именная фраза, без markdown).
2. "description" — описание (≤1000 символов, 2-4 предложения по-русски): что общего у этих блоков.
3. "branch" — одна из 12 веток компании ИЛИ "none" если ни одна не подходит:
   - strategy — стратегия и видение
   - clients — работа с клиентами и аккаунт-менеджмент
   - sales — продажи и сделки
   - marketing — маркетинг и продвижение
   - product — продукт, фичи, бэклог
   - operations — операционка и процессы
   - team — команда, найм, культура
   - finance — финансы и бюджет
   - technology — технологии, инфраструктура
   - production — производство / поставки
   - partnerships — партнёрства
   - legal — юридические вопросы
4. "tags" — 1-10 коротких ключевых слов (каждое ≤30 символов).
5. "weight" — важность темы для бизнеса (0..1; 0.7+ для критичных тем).
6. "confidence" — уверенность в кластере (0..1; 0.8+ для очевидной темы).

Правила:
- Не выдумывай связи. Если блоки разнородные — низкий confidence.
- name на русском, без эмодзи и без кавычек.
- Ответ — строго JSON по схеме.`;

interface Fixture {
  blocks: Array<{
    id: string;
    name: string;
    criticalQuestion: string;
    trustedAnswer: string;
    signalType: string;
    tags: string[];
  }>;
  entities: Array<{ id: string; canonicalName: string; type: string }>;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_theme_classify',
    description: 'Вернуть классификацию тематического кластера.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description', 'branch', 'tags', 'weight', 'confidence'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        branch: {
          type: 'string',
          enum: [
            'strategy',
            'clients',
            'sales',
            'marketing',
            'product',
            'operations',
            'team',
            'finance',
            'technology',
            'production',
            'partnerships',
            'legal',
            'none',
          ],
        },
        tags: { type: 'array', items: { type: 'string' } },
        weight: { type: 'number' },
        confidence: { type: 'number' },
      },
    },
  },
};

async function main(): Promise<void> {
  console.log(`=== smoke ${TASK_TYPE} (${MODEL}) ===`);
  const f = await readFixture<Fixture>(TASK_TYPE);

  const userPayload = {
    blocks: f.blocks,
    entities: f.entities,
  };
  const userMessage =
    `Кластер из ${f.blocks.length} блоков:\n\n${JSON.stringify(userPayload, null, 2)}` +
    '\n\nВерни результат через инструмент submit_theme_classify.';

  const start = Date.now();
  let usage: Usage = {};
  let error: string | null = null;
  let modelResponse = '';
  let ranSuccessfully = false;

  try {
    const resp = (await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4000,
      tools: [TOOL],
      tool_choice: 'auto',
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: Usage;
    };
    usage = resp.usage ?? {};
    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (call) {
      modelResponse = shortResponse(call.function.arguments);
      JSON.parse(call.function.arguments);
      ranSuccessfully = true;
    } else {
      modelResponse = shortResponse(msg?.content ?? '');
      error = 'модель не позвала tool';
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - start;
  const cost = computeCost(usage);
  const report: SmokeReport = {
    taskType: TASK_TYPE,
    promptFound: true,
    ranSuccessfully,
    tokensIn: cost.tokensIn,
    tokensOut: cost.tokensOut,
    cachedTokens: cost.cachedTokens,
    costUsd: cost.costUsd,
    ms,
    modelResponse,
    error,
  };
  logRun(TASK_TYPE, report);
  await writeReport(TASK_TYPE, report);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
