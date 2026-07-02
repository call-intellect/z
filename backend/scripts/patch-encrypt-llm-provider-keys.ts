import { CryptoService } from '../src/common/crypto/crypto.service';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

function makeCfgStub(): { crypto: { masterKey: string } } {
  const raw = process.env['CRYPTO_MASTER_KEY'] ?? '';
  if (!raw) {
    throw new Error(
      'patch-encrypt-llm-provider-keys: ENV CRYPTO_MASTER_KEY не задан. ' +
        'Шифровать нечем — сначала пропиши ключ в .env.',
    );
  }
  return { crypto: { masterKey: raw } };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-encrypt-llm-provider-keys START ===');

  const crypto = new CryptoService(makeCfgStub() as never);

  const rows = await prisma.llmProvider.findMany({
    where: { apiKeyEncrypted: { not: null } },
    select: { id: true, name: true, apiKeyEncrypted: true },
  });
  // eslint-disable-next-line no-console
  console.log(`Провайдеров с apiKeyEncrypted: ${rows.length}`);

  let alreadyEncrypted = 0;
  let encrypted = 0;
  for (const row of rows) {
    const plaintext = row.apiKeyEncrypted;
    if (!plaintext || crypto.isEncrypted(plaintext)) {
      alreadyEncrypted += 1;
      continue;
    }
    const encStr = crypto.encrypt(plaintext);
    await prisma.llmProvider.update({
      where: { id: row.id },
      data: { apiKeyEncrypted: encStr },
    });
    encrypted += 1;
    // eslint-disable-next-line no-console
    console.log(`[patch] provider name=${row.name} id=${row.id} → encrypted`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `scanned=${rows.length}, encrypted=${encrypted}, already_encrypted=${alreadyEncrypted}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== patch-encrypt-llm-provider-keys DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-encrypt-llm-provider-keys FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
