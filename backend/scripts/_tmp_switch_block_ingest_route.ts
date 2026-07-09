import { createPrismaClient } from './_lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const provider = await prisma.llmProvider.update({
    where: { name: 'minimax' },
    data: {
      protocolKind: 'anthropic-messages',
      baseUrl: 'https://api.minimax.io/anthropic',
    },
    select: { name: true, protocolKind: true, baseUrl: true, defaultModelKey: true },
  });
  console.log('provider updated:', provider);

  const primary = await prisma.llmTaskRoute.update({
    where: { id: 'cmrcjus6u0000kxrbh6cfei6v' },
    data: {
      providerName: 'minimax',
      model: 'MiniMax-M3',
      editedByAdmin: true,
    },
    select: { taskType: true, tier: true, providerName: true, model: true },
  });
  console.log('primary route:', primary);

  const existingSecondary = await prisma.llmTaskRoute.findFirst({
    where: {
      taskType: 'block-ingest',
      tenantId: null,
      tier: 'secondary',
      providerName: 'llm-kora-team',
    },
    select: { id: true },
  });
  const secondary = existingSecondary
    ? await prisma.llmTaskRoute.update({
        where: { id: existingSecondary.id },
        data: { model: 'gemma4:e4b', isActive: true, editedByAdmin: true },
        select: { taskType: true, tier: true, providerName: true, model: true },
      })
    : await prisma.llmTaskRoute.create({
        data: {
          taskType: 'block-ingest',
          tier: 'secondary',
          priority: 0,
          providerName: 'llm-kora-team',
          model: 'gemma4:e4b',
          isActive: true,
          editedByAdmin: true,
        },
        select: { taskType: true, tier: true, providerName: true, model: true },
      });
  console.log('secondary route:', secondary);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
