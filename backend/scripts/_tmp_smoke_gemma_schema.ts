import { CryptoService } from '../src/common/crypto/crypto.service';
import { createPrismaClient } from './_lib/prisma';
import { BLOCK_INGEST_JSON_SCHEMA } from '../src/modules/knowledge-core/prompts/block-ingest.prompt';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const crypto = new CryptoService({ crypto: { masterKey: process.env['CRYPTO_MASTER_KEY']! } } as never);
  const p = await prisma.llmProvider.findUnique({
    where: { name: 'llm-kora-team' },
    select: { apiKeyEncrypted: true, defaultModelKey: true, baseUrl: true },
  });
  if (!p?.apiKeyEncrypted) throw new Error('no key');
  const key = crypto.decrypt(p.apiKeyEncrypted);

  const userMsg = 'Вот переписка: Менеджер: Добрый день! Клиент: Здравствуйте, хочу заказать. Менеджер: Хорошо, оформим на 5000р. Извлеки знания.';

  const body = {
    model: p.defaultModelKey,
    messages: [
      { role: 'system', content: 'Ты извлекаешь знания из переписки в JSON по схеме.' },
      { role: 'user', content: userMsg },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'IdeaBlocks', strict: true, schema: BLOCK_INGEST_JSON_SCHEMA } },
    max_tokens: 2000,
  };

  console.log('=== GEMMA strict json_schema test ===');
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  console.log('HTTP', res.status);
  const text = await res.text();
  console.log('RAW RESPONSE (first 1500):');
  console.log(text.slice(0, 1500));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
