import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface CronSeed {
  name: string;
  expression: string;
  description: string;
}

const SEEDS: CronSeed[] = [
  {
    name: 'BitrixSyncCron.runDaily',
    expression: '0 0 * * *',
    description: 'Суточный забор данных Bitrix24 (00:00).',
  },
  {
    name: 'ChatboxSyncCron.runDaily',
    expression: '0 0 * * *',
    description: 'Суточный инкрементальный забор диалогов ChatBox (00:00).',
  },
  {
    name: 'BitrixAnalyzeCron.sweep',
    expression: '0 0 * * *',
    description: 'AI-анализ диалогов Bitrix24 (00:00).',
  },
  {
    name: 'ChatboxAnalyzeCron.sweep',
    expression: '0 0 * * *',
    description: 'AI-анализ диалогов ChatBox (00:00).',
  },
  {
    name: 'IntegrationSyncLogPruneCron.run',
    expression: '0 4 * * *',
    description: 'Очистка журнала IntegrationSyncRun старше 90 дней (04:00).',
  },
];

async function main(): Promise<void> {
  console.log('=== seed-integration-crons START ===');
  let created = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    const existing = await prisma.cronSchedule.findUnique({
      where: { name: seed.name },
      select: { name: true },
    });
    if (existing) {
      skipped++;
      console.log(`[skip] ${seed.name} (строка уже есть — расписание не трогаем)`);
      continue;
    }
    await prisma.cronSchedule.create({
      data: {
        name: seed.name,
        expression: seed.expression,
        defaultExpression: seed.expression,
        enabled: true,
        description: seed.description,
      },
    });
    created++;
    console.log(`[create] ${seed.name} → ${seed.expression}`);
  }

  console.log(`created=${created}, skipped=${skipped}`);
  console.log('=== seed-integration-crons DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-integration-crons FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
