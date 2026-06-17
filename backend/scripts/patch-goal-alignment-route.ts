import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model?: string;
}

const PROVIDERS: ProviderEntry[] = [
  { provider: 'anthropic' },
  { provider: 'deepseek' },
  { provider: 'openai-via-proxy' },
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== patch-goal-alignment-route START ===');

  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType: 'goal-alignment', tenantId: null },
  });

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `[skipped] goal-alignment route уже существует (id=${existing.id}, isActive=${existing.isActive}). admin-edited не перезаписываем.`,
    );
    return;
  }

  const created = await prisma.llmTaskRoute.create({
    data: {
      taskType: 'goal-alignment',
      tenantId: null,
      providers: PROVIDERS as unknown as object,
      isActive: true,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[created] goal-alignment route id=${created.id}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-goal-alignment-route FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('=== patch-goal-alignment-route DONE ===');
  });
