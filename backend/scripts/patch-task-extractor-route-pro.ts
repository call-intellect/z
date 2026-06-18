import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPES = ['tasks', 'meeting-extract-actions'] as const;

const TARGET_PROVIDER = 'deepseek';
const TARGET_MODEL = 'deepseek-v4-pro';

interface PatchStats {
  switched: number;
  alreadyPro: number;
  protectedByAdmin: number;
  noPrimaryFound: number;
}

async function applyForTaskType(taskType: string, stats: PatchStats): Promise<void> {
  const primary = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null, tier: 'primary' },
    orderBy: { priority: 'asc' },
  });

  if (!primary) {
    stats.noPrimaryFound++;

    console.log(
      `[skip:no-primary] ${taskType} — нет нормализованного primary-маршрута (tier=primary). ` +
        `Сначала прогоните дефолтный seed (seed-llm-task-routes-default.ts).`,
    );
    return;
  }

  if (primary.editedByAdmin) {
    stats.protectedByAdmin++;

    console.log(
      `[skip:edited-by-admin] ${taskType}/primary — админ владеет маршрутом ` +
        `(${primary.providerName}:${primary.model}); не трогаем.`,
    );
    return;
  }

  if (
    primary.providerName === TARGET_PROVIDER &&
    primary.model === TARGET_MODEL &&
    primary.isActive === true
  ) {
    stats.alreadyPro++;

    console.log(`[skip:already-pro] ${taskType}/primary уже ${TARGET_PROVIDER}:${TARGET_MODEL}`);
    return;
  }

  await prisma.llmTaskRoute.update({
    where: { id: primary.id },
    data: { providerName: TARGET_PROVIDER, model: TARGET_MODEL, isActive: true },
  });
  stats.switched++;

  console.log(
    `[switch] ${taskType}/primary ${primary.providerName}:${primary.model} → ` +
      `${TARGET_PROVIDER}:${TARGET_MODEL}`,
  );
}

async function main(): Promise<void> {
  console.log('=== patch-task-extractor-route-pro START (OWNER-GATED, не авто-выкат) ===');

  const stats: PatchStats = {
    switched: 0,
    alreadyPro: 0,
    protectedByAdmin: 0,
    noPrimaryFound: 0,
  };

  for (const taskType of TASK_TYPES) {
    await applyForTaskType(taskType, stats);
  }

  console.log('');

  console.log(
    `switched=${stats.switched}, already_pro=${stats.alreadyPro}, ` +
      `protected_by_admin=${stats.protectedByAdmin}, no_primary_found=${stats.noPrimaryFound}`,
  );
}

main()
  .catch((err) => {
    console.error('patch-task-extractor-route-pro FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();

    console.log('=== patch-task-extractor-route-pro DONE ===');
  });
