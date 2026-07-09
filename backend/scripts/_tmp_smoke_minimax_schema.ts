import { CryptoService } from '../src/common/crypto/crypto.service';
import { createPrismaClient } from './_lib/prisma';
import { BLOCK_INGEST_JSON_SCHEMA } from '../src/modules/knowledge-core/prompts/block-ingest.prompt';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const crypto = new CryptoService({ crypto: { masterKey: process.env['CRYPTO_MASTER_KEY']! } } as never);
  const p = await prisma.llmProvider.findUnique({
    where: { name: 'minimax' },
    select: { apiKeyEncrypted: true, defaultModelKey: true, baseUrl: true, protocolKind: true },
  });
  if (!p?.apiKeyEncrypted) throw new Error('no key');
  const key = crypto.decrypt(p.apiKeyEncrypted);
  console.log('minimax protocolKind:', p.protocolKind, 'model:', p.defaultModelKey);

  const userMsg = 'Вот переписка: Менеджер: Добрый день! Клиент: Здравствуйте, хочу заказать. Менеджер: Хорошо, оформим на 5000р.';

  // 1) текущая схема с union-типами (ожидаем 400)
  console.log('\n=== TEST 1: текущая схема (union-типы) ===');
  const r1 = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: p.defaultModelKey,
      messages: [
        { role: 'system', content: 'Извлеки знания в JSON.' },
        { role: 'user', content: userMsg },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'IdeaBlocks', strict: true, schema: BLOCK_INGEST_JSON_SCHEMA } },
      max_tokens: 2000,
    }),
  });
  console.log('HTTP', r1.status);
  console.log((await r1.text()).slice(0, 400));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
