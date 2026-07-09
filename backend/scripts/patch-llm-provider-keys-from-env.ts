import { CryptoService } from '../src/common/crypto/crypto.service';
import { createPrismaClient } from './_lib/prisma';

const ENV_KEY_BY_PROVIDER: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  grsai: 'GRSAI_API_KEY',
  ollama: 'OLLAMA_API_KEY',
  kie: 'KIE_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

async function main(): Promise<void> {
  const masterKey = process.env['CRYPTO_MASTER_KEY'];
  if (!masterKey) {
    console.log('[patch-llm-provider-keys] CRYPTO_MASTER_KEY не задан — пропуск (нечем шифровать).');
    return;
  }
  const prisma = createPrismaClient();
  const crypto = new CryptoService({ crypto: { masterKey } } as never);

  const providers = await prisma.llmProvider.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, apiKeyEncrypted: true },
  });

  let filled = 0;
  let hasKey = 0;
  let noEnv = 0;
  for (const p of providers) {
    if (p.apiKeyEncrypted && p.apiKeyEncrypted.length > 0) {
      hasKey += 1;
      continue;
    }
    const envName = ENV_KEY_BY_PROVIDER[p.name];
    const envValue = envName ? process.env[envName]?.trim() : undefined;
    if (!envName || !envValue) {
      noEnv += 1;
      console.log(
        `[patch-llm-provider-keys] ${p.name}: ключа в БД нет, ENV ${envName ?? '—'} пуст — пропуск`,
      );
      continue;
    }
    await prisma.llmProvider.update({
      where: { id: p.id },
      data: { apiKeyEncrypted: crypto.encrypt(envValue) },
    });
    filled += 1;
    console.log(`[patch-llm-provider-keys] ${p.name}: ключ перенесён из ${envName} (зашифрован)`);
  }

  console.log(
    `[patch-llm-provider-keys] done. filled=${filled}, skipped_has_key=${hasKey}, skipped_no_env=${noEnv}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
