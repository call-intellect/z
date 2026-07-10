import { CryptoService } from '../src/common/crypto/crypto.service';
import { createPrismaClient } from './_lib/prisma';
import { BLOCK_INGEST_JSON_SCHEMA } from '../src/modules/knowledge-core/prompts/block-ingest.prompt';
import { toOpenAiStrictSchema } from '../src/modules/ai/services/strict-json-schema.util';

interface ProbeResult {
  name: string;
  status: number;
  bodyHead: string;
}

async function probe(
  baseUrl: string,
  key: string,
  model: string,
  name: string,
  schema: Record<string, unknown>,
  userMsg: string,
  maxTokens: number,
): Promise<ProbeResult> {
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Ты извлекаешь структурированные данные. Верни строго JSON по схеме.' },
        { role: 'user', content: userMsg },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'Probe', strict: true, schema },
      },
      max_tokens: maxTokens,
    }),
  });
  const body = await r.text();
  return { name, status: r.status, bodyHead: body.slice(0, 600) };
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const crypto = new CryptoService({
    crypto: { masterKey: process.env['CRYPTO_MASTER_KEY']! },
  } as never);
  const p = await prisma.llmProvider.findUnique({
    where: { name: 'minimax' },
    select: { apiKeyEncrypted: true, defaultModelKey: true, baseUrl: true, protocolKind: true },
  });
  if (!p?.apiKeyEncrypted) throw new Error('no key');
  const key = crypto.decrypt(p.apiKeyEncrypted);
  const model = p.defaultModelKey!;
  console.log('minimax protocolKind:', p.protocolKind, 'model:', model, 'baseUrl:', p.baseUrl);

  const shortMsg = 'Менеджер: сделаю отчёт к пятнице. Клиент: спасибо.';

  const anyOfSchema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'dueDate', 'score'],
    properties: {
      summary: { type: 'string' },
      dueDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      score: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
    },
  };

  const nullTypeSchema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'mission'],
    properties: {
      summary: { type: 'string' },
      mission: { type: 'null' },
    },
  };

  const unionSchema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'dueDate'],
    properties: {
      summary: { type: 'string' },
      dueDate: { type: ['string', 'null'] },
    },
  };

  const results: ProbeResult[] = [];
  results.push(await probe(p.baseUrl, key, model, 'A: anyOf-nullable', anyOfSchema, shortMsg, 500));
  results.push(await probe(p.baseUrl, key, model, 'B: type-null', nullTypeSchema, shortMsg, 500));
  results.push(await probe(p.baseUrl, key, model, 'C: union-type (baseline, ждём 400)', unionSchema, shortMsg, 500));

  const fullMsg =
    'Сегменты: [{"index":0,"startMs":0,"endMs":5000,"speakers":["Анна"],"text":"Я подготовлю смету к пятнице и отправлю Марине."}] Верни JSON по схеме.';
  const fullStrict = toOpenAiStrictSchema(BLOCK_INGEST_JSON_SCHEMA) as Record<string, unknown>;
  results.push(await probe(p.baseUrl, key, model, 'D: full schema через toOpenAiStrictSchema', fullStrict, fullMsg, 4000));

  for (const r of results) {
    console.log(`\n=== ${r.name} → HTTP ${r.status} ===`);
    console.log(r.bodyHead);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
