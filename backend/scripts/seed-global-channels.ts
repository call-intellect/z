import { createPrismaClient } from './_lib/prisma';

const GLOBAL_KINDS = ['telegram_bot'] as const;

const prisma = createPrismaClient();

async function main(): Promise<void> {
  console.log('[seed-global-channels] START');

  let created = 0;
  let skipped = 0;
  for (const kind of GLOBAL_KINDS) {
    const existing = await prisma.channel.findFirst({
      where: { tenantId: null, kind },
    });
    if (existing) {
      console.log(
        `[seed-global-channels] kind=${kind} уже есть (id=${existing.id}, status=${existing.status}) — пропуск`,
      );
      skipped++;
      continue;
    }
    const ch = await prisma.channel.create({
      data: {
        tenantId: null,
        kind,
        direction: 'bidirectional',
        maxDataClass: 'internal',
        status: 'active',
        config: {},
      },
    });
    console.log(
      `[seed-global-channels] kind=${kind} создан (id=${ch.id}, config пустой — настройте через setup:telegram-bot)`,
    );
    created++;
  }
  console.log(`[seed-global-channels] DONE: created=${created} skipped=${skipped}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed-global-channels] FATAL:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
