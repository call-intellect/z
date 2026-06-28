import { type Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'chat_presence_ttl_seconds',
    value: 60,
    category: 'chat',
    section: 'presence',
    severity: 'low',
    description:
      'TTL (сек) записи presence участника разговора в Redis. Истёкшие presence-записи лениво вычищаются; переживает рестарт инстанса. По умолчанию 60.',
  },
  {
    key: 'chat_outbox_sweep_stale_seconds',
    value: 30,
    category: 'chat',
    section: 'delivery',
    severity: 'low',
    description:
      'Порог «застрял» (сек) для backstop-sweep transactional outbox: pending-записи старше этого порога пере-ставятся в очередь доставки. По умолчанию 30.',
  },
  {
    key: 'chat_outbox_sweep_batch_limit',
    value: 200,
    category: 'chat',
    section: 'delivery',
    severity: 'low',
    description:
      'Лимит батча backstop-sweep transactional outbox за один проход. По умолчанию 200.',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;
    console.log(`[create] ${seed.key}`);
    return;
  }

  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;
    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;
  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
  console.log('=== seed-admin-setting-chat START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
  console.log('=== seed-admin-setting-chat DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-chat FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
