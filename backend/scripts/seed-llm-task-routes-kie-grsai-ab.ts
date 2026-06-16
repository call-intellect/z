import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface AbSeed {
  taskType: string;
  controlProvider: string;
  controlModel: string;
  variantProvider: string;
  variantModel: string;
  splitPercent: number;
  notes: string;
}

const SEEDS: AbSeed[] = [
  {
    taskType: 'dialog-multi-query',
    controlProvider: 'deepseek',
    controlModel: 'deepseek-v4-flash',
    variantProvider: 'kie',
    variantModel: 'gemini-3-flash',
    splitPercent: 10,
    notes:
      'Сравнение качества/латентности/цены DeepSeek-v4-flash vs Gemini 3 Flash ' +
      '(через KIE). 10% трафика на variant. Запуск — вручную из админки ' +
      '/admin/ai-models/dialog-multi-query. KIE нестабилен — primary держим ' +
      'DeepSeek; variant — для измерения, не для отказоустойчивости.',
  },
];

async function pickSystemAdminUserId(): Promise<string> {
  const superAdmin = await prisma.user.findFirst({
    where: { isSuperAdmin: true, deletedAt: null },
    select: { id: true },
  });
  if (superAdmin) return superAdmin.id;

  const adminUser = await prisma.user.findFirst({
    where: { role: 'admin', deletedAt: null },
    select: { id: true },
  });
  if (adminUser) return adminUser.id;

  throw new Error(
    'seed-llm-task-routes-kie-grsai-ab: не найден super_admin или admin user. ' +
      'Заведи администратора: bun run scripts/set-admin-password.ts',
  );
}

interface SeedStats {
  inserted: number;
  skipped: number;
}

async function applySeed(seed: AbSeed, createdById: string, stats: SeedStats): Promise<void> {
  const existing = await prisma.llmModelExperiment.findFirst({
    where: {
      tenantId: null,
      taskType: seed.taskType,
      controlModel: seed.controlModel,
      variantModel: seed.variantModel,
      status: 'draft',
    },
  });
  if (existing) {
    stats.skipped++;
    // eslint-disable-next-line no-console
    console.log(
      `[skip:exists-draft] ${seed.taskType} ${seed.controlProvider}/${seed.controlModel} → ${seed.variantProvider}/${seed.variantModel}`,
    );
    return;
  }
  const running = await prisma.llmModelExperiment.findFirst({
    where: {
      tenantId: null,
      taskType: seed.taskType,
      controlModel: seed.controlModel,
      variantModel: seed.variantModel,
      status: 'running',
    },
  });
  if (running) {
    stats.skipped++;
    // eslint-disable-next-line no-console
    console.log(
      `[skip:running-exists] ${seed.taskType} ${seed.controlProvider}/${seed.controlModel} → ${seed.variantProvider}/${seed.variantModel}`,
    );
    return;
  }

  await prisma.llmModelExperiment.create({
    data: {
      tenantId: null,
      taskType: seed.taskType,
      controlProvider: seed.controlProvider,
      controlModel: seed.controlModel,
      variantProvider: seed.variantProvider,
      variantModel: seed.variantModel,
      splitPercent: seed.splitPercent,
      status: 'draft',
      createdById,
      notes: seed.notes,
    },
  });
  stats.inserted++;
  // eslint-disable-next-line no-console
  console.log(
    `[insert:draft] ${seed.taskType} ${seed.controlProvider}/${seed.controlModel} → ${seed.variantProvider}/${seed.variantModel} (${seed.splitPercent}%)`,
  );
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-kie-grsai-ab START ===');

  const createdById = await pickSystemAdminUserId();
  // eslint-disable-next-line no-console
  console.log(`createdById = ${createdById}`);

  const stats: SeedStats = { inserted: 0, skipped: 0 };
  for (const seed of SEEDS) {
    await applySeed(seed, createdById, stats);
  }

  // eslint-disable-next-line no-console
  console.log(`inserted=${stats.inserted}, skipped=${stats.skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-kie-grsai-ab DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-kie-grsai-ab FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
