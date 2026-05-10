/**
 * Patch — гарантирует наличие глобального LlmTaskRoute для taskType=`dashboard-summary`
 * (Фаза 8 шаг 2 knowledge-core).
 *
 * Идемпотентен:
 *   - если запись уже есть (например, посеяна `seed-llm-task-routes-knowledge-core.ts`),
 *     НЕ перезаписывает её — это admin-edited контракт (skill `safe-seed-rules`);
 *   - если записи нет — создаёт с провайдерами `[anthropic, deepseek]` и
 *     `isActive=true`.
 *
 * Запуск:
 *   bun run scripts/patch-dashboard-summary-route.ts
 *
 * Безопасно повторно — каждый прогон либо `[skipped]`, либо `[created]`.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProviderEntry {
  provider: string;
  model?: string;
}

const PROVIDERS: ProviderEntry[] = [
  { provider: 'anthropic' },
  { provider: 'deepseek' },
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-dashboard-summary-route START ===');

  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType: 'dashboard-summary', tenantId: null },
  });

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `[skipped] dashboard-summary route уже существует (id=${existing.id}, isActive=${existing.isActive}). admin-edited не перезаписываем.`,
    );
    return;
  }

  const created = await prisma.llmTaskRoute.create({
    data: {
      taskType: 'dashboard-summary',
      tenantId: null,
      providers: PROVIDERS as unknown as object,
      isActive: true,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[created] dashboard-summary route id=${created.id}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-dashboard-summary-route FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('=== patch-dashboard-summary-route DONE ===');
  });
