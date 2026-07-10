import Anthropic from '@anthropic-ai/sdk';

import { CryptoService } from '../src/common/crypto/crypto.service';
import {
  buildAnthropicToolBindings,
  mapAnthropicResponseToOutput,
} from '../src/modules/ai/services/anthropic.service';
import type { LlmCompleteInput } from '../src/modules/ai/services/llm.types';
import {
  BLOCK_INGEST_JSON_SCHEMA,
  buildBlockIngestPrompt,
} from '../src/modules/knowledge-core/prompts/block-ingest.prompt';
import { createPrismaClient } from './_lib/prisma';

const ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
const MODEL = 'MiniMax-M3';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const crypto = new CryptoService({
    crypto: { masterKey: process.env['CRYPTO_MASTER_KEY']! },
  } as never);
  const p = await prisma.llmProvider.findUnique({
    where: { name: 'minimax' },
    select: { apiKeyEncrypted: true },
  });
  if (!p?.apiKeyEncrypted) throw new Error('no key');
  const key = crypto.decrypt(p.apiKeyEncrypted);

  const { system, user } = buildBlockIngestPrompt({
    meetingTitle: 'Переписка с клиентом',
    meetingDateIso: '2026-07-08T10:00:00.000Z',
    meetingType: 'chat',
    participants: ['Анна (менеджер)', 'Клиент'],
    segments: [
      {
        startMs: 0,
        endMs: 5000,
        speakers: ['Анна'],
        text: 'Добрый день! Я подготовлю смету по доставке к пятнице и отправлю Марине на почту.',
      },
      {
        startMs: 5000,
        endMs: 9000,
        speakers: ['Клиент'],
        text: 'Спасибо. И ещё: у нас второй день не выгружается отчёт по остаткам, а завтра инвентаризация.',
      },
      {
        startMs: 9000,
        endMs: 14000,
        speakers: ['Анна'],
        text: 'Поняла, это критично. Решили так: сначала чиним выгрузку, потом возвращаемся к смете.',
      },
    ] as never,
  });

  const input: LlmCompleteInput = {
    system: { text: system },
    user: { text: user },
    maxTokens: 4096,
    responseFormat: {
      type: 'json_schema',
      name: 'IdeaBlocks',
      strict: true,
      schema: BLOCK_INGEST_JSON_SCHEMA,
    },
  } as never;

  const { tools, toolChoice } = buildAnthropicToolBindings(input);
  const client = new Anthropic({ apiKey: key, baseURL: ANTHROPIC_BASE_URL });
  const started = Date.now();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    ...(tools ? { tools: tools as never } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    stream: false,
  });
  const latencyMs = Date.now() - started;

  console.log('stop_reason:', message.stop_reason, 'latencyMs:', latencyMs);
  console.log('content blocks:', message.content.map((b) => b.type).join(', '));
  console.log('usage:', JSON.stringify(message.usage));

  const out = mapAnthropicResponseToOutput(
    message as never,
    MODEL,
    'minimax',
    input.responseFormat,
  );
  console.log('\n--- mapped text (head 400) ---');
  console.log(out.text.slice(0, 400));

  try {
    const parsed = JSON.parse(out.text) as Record<string, unknown>;
    const blocks = Array.isArray(parsed['blocks']) ? (parsed['blocks'] as unknown[]) : [];
    console.log('\nJSON.parse: OK; keys =', Object.keys(parsed).join(','));
    console.log('blocks count =', blocks.length);
    for (const b of blocks) {
      const bb = b as Record<string, unknown>;
      console.log(' •', bb['signalType'], '—', bb['name']);
    }
  } catch (e) {
    console.log('\nJSON.parse: FAIL —', e instanceof Error ? e.message : String(e));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
