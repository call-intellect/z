import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { DailyCostAggregatorCron } from '../src/modules/admin/economics/daily-cost-aggregator.cron';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const GAP_START = '2026-05-09';
const GAP_END_EXCLUSIVE = '2026-05-24';

async function main(): Promise<void> {
  const preCheckPrisma = createPrismaClient();
  try {
    const existing = await preCheckPrisma.aiCostDaily.count({
      where: { date: { gte: new Date(GAP_START), lt: new Date(GAP_END_EXCLUSIVE) } },
    });
    if (existing > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `backfill-ai-cost-daily-gap: уже применено (${existing} строк в диапазоне). Выход.`,
      );
      return;
    }
  } finally {
    await preCheckPrisma.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const cron = app.get(DailyCostAggregatorCron);

    // eslint-disable-next-line no-console
    console.log(`=== backfill-ai-cost-daily-gap START (${GAP_START}..${GAP_END_EXCLUSIVE}) ===`);

    let date = new Date(GAP_START);
    const end = new Date(GAP_END_EXCLUSIVE);
    let totalRows = 0;
    while (date < end) {
      const result = await cron.runForDate(date);
      totalRows += result.rowsUpserted;
      // eslint-disable-next-line no-console
      console.log(`progress: date=${result.date} rowsUpserted=${result.rowsUpserted}`);
      date = new Date(date.getTime() + 86_400_000);
    }

    // eslint-disable-next-line no-console
    console.log(`=== DONE totalRowsUpserted=${totalRows} ===`);
  } finally {
    await app.close();
  }
}

silenceRedisShutdownNoise();
main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-ai-cost-daily-gap FAILED:', err);
    process.exit(1);
  });
