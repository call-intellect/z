import { CryptoService } from '../src/common/crypto/crypto.service';
import { createPrismaClient } from './_lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const crypto = new CryptoService({
    crypto: { masterKey: process.env['CRYPTO_MASTER_KEY']! },
  } as never);
  const p = await prisma.embeddingProvider.findFirst({
    where: { name: 'local', deletedAt: null },
    select: { baseUrl: true, apiKeyEncrypted: true },
  });
  if (!p) throw new Error('no local embedding provider');
  const key = p.apiKeyEncrypted ? crypto.decrypt(p.apiKeyEncrypted) : '';
  const models = await prisma.embeddingModel.findMany({
    select: { modelKey: true, dimensions: true, isActive: true },
  });
  console.log('models:', JSON.stringify(models));

  const model = models.find((m) => m.isActive)?.modelKey ?? 'embeddinggemma';
  const started = Date.now();
  const r = await fetch(`${p.baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: 'Проверка размерности эмбеддинга.' }),
  });
  const latency = Date.now() - started;
  const body = (await r.json()) as {
    data?: Array<{ embedding?: number[] }>;
    error?: unknown;
  };
  const dim = body.data?.[0]?.embedding?.length;
  console.log('HTTP', r.status, 'latencyMs', latency, 'model', model, 'dim', dim);
  if (body.error) console.log('error:', JSON.stringify(body.error).slice(0, 300));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
