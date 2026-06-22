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
    key: 'goals.pulse.enabled',
    value: true,
    category: 'goals',
    section: 'pulse',
    severity: 'medium',
    description:
      'Включает еженедельный cron пульса целей (пн 09:00 МСК). False → cron работает в no-op (без рестарта).',
  },
  {
    key: 'goals.pulse.deliver_to_telegram',
    value: false,
    category: 'goals',
    section: 'pulse',
    severity: 'medium',
    description:
      'Если true — после генерации пульс целей отправляется через ConversationalService.sendNotification(eventType=goals.pulse) ролям owner и coo. По умолчанию false, чтобы Telegram не молотил сразу после раскатки.',
  },
  {
    key: 'goals.minExtractConfidence',
    value: 0.4,
    category: 'goals',
    section: 'extraction',
    severity: 'medium',
    description:
      'Мин. уверенность, чтобы реплику считать целью. Ниже порога специалист 3-14 пропускает блок (не создаёт цель). Диапазон 0..1.',
  },
  {
    key: 'goals.autoPromoteConfidence',
    value: 0.8,
    category: 'goals',
    section: 'extraction',
    severity: 'low',
    description:
      'Уверенность для авто-продвижения цели: при >= этого значения AI-цель сразу создаётся в состоянии active, иначе suggested. Диапазон 0..1.',
  },
  {
    key: 'goals.maxActiveGoalsPerHorizon',
    value: 7,
    category: 'goals',
    section: 'extraction',
    severity: 'low',
    description:
      'Макс. активных целей на горизонт (фокус-лимит). При достижении специалист 3-14 не плодит новые цели этого горизонта. Целое число.',
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
  console.log('=== seed-admin-setting-goals-pulse START ===');

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

  console.log('=== seed-admin-setting-goals-pulse DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-goals-pulse FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
