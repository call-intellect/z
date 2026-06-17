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
    key: 'notifications.daily_budget.per_person',
    value: 5,
    category: 'notifications',
    section: 'daily_budget',
    severity: 'medium',
    description:
      'Сколько push-уведомлений (Telegram/MAX/email) приходит одному сотруднику в его локальный день. Сверх лимита — push откладывается, in_app остаётся виден. По умолчанию 5.',
  },
  {
    key: 'notifications.quiet_hours.start',
    value: 22,
    category: 'notifications',
    section: 'quiet_hours',
    severity: 'low',
    description:
      'Час начала «тихих часов» (0..23, локальная TZ сотрудника). В это окно не-критические push откладываются. По умолчанию 22.',
  },
  {
    key: 'notifications.quiet_hours.end',
    value: 8,
    category: 'notifications',
    section: 'quiet_hours',
    severity: 'low',
    description:
      'Час конца «тихих часов» (0..23, локальная TZ сотрудника). По умолчанию 8 (окно 22→8 проходит через полночь).',
  },
  {
    key: 'notifications.daily_budget.enabled',
    value: true,
    category: 'notifications',
    section: 'daily_budget',
    severity: 'medium',
    description:
      'Kill-switch дневного бюджета push-уведомлений. true (Ship-On) — лимит и тихие часы применяются. false — push не ограничивается (как до фичи).',
  },
  {
    key: 'notifications.binding_campaign.enabled',
    value: true,
    category: 'notifications',
    section: 'binding_campaign',
    severity: 'medium',
    description:
      'Kill-switch кампании привязки Telegram-канала (приглашение + напоминание сотрудникам без привязки, локальные 9:00). true (Ship-On).',
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
  console.log('=== seed-admin-setting-notification-budget START ===');

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
  console.log('=== seed-admin-setting-notification-budget DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-notification-budget FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
