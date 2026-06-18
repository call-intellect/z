import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model?: string;
}

const PROVIDERS: ProviderEntry[] = [{ provider: 'anthropic' }, { provider: 'deepseek' }];

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
